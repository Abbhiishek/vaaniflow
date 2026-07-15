// Dictation session state machine.
//
//   idle ──hotkey down──▶ recording(ptt)
//     recording: released within TAP_MS  ──▶ recording(handsfree)
//     recording(ptt): Space while held ──▶ recording(handsfree)
//     recording(ptt): released after TAP_MS ──▶ processing
//     recording(handsfree): Space / hotkey tap / widget click / silence ──▶ processing
//     recording: Esc / widget ✕ ──▶ idle (discard)
//   processing ──transcribe → commands → polish → corrections──▶ paste + save ──▶ idle
//
// Fast mode: while recording, the overlay cuts audio at natural pauses and
// streams chunks here; each is transcribed immediately (sequentially, with the
// previous chunk's tail as decoder context) and echoed back to the overlay as a
// live caption. On stop, only the final chunk's latency is felt.
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { EventEmitter } = require('events');
const { transcribe, warmup } = require('./transcriber');
const { polishText, polishWarmup } = require('./polisher');
const { pickStyle } = require('./tones');
const { replacementRules } = require('./dictionary');
const {
  cleanArtifacts,
  applyReplacements,
  applyScratchThat,
  applySpokenCommands,
  expandSnippets,
  restoreSnippets,
  snippetTokensPreserved,
  buildPrompt
} = require('./postprocess');

const TAP_MS = 350; // held shorter than this = "tap" → hands-free mode
const MIN_AUDIO_MS = 350; // discard blips shorter than this
const MAX_RECORD_MS = 5 * 60 * 1000;
const INTRUDE_WINDOW_MS = 700; // other key right after combo-down = app shortcut, not dictation
const FAILED_AUDIO_KEEP = 6; // rescued WAVs kept on disk before pruning oldest

class Session extends EventEmitter {
  constructor({ store, injector, getOverlay, getRuntimeSettings, systemAudio }) {
    super();
    this.store = store;
    this.injector = injector;
    this.getOverlay = getOverlay;
    this.getRuntimeSettings = getRuntimeSettings;
    this.systemAudio = systemAudio || null;
    this.audioMuteTimer = null;
    this.audioMutedForSession = false;
    this.state = 'idle'; // idle | recording | processing
    this.mode = 'ptt'; // ptt | handsfree
    this.downAt = 0;
    this.endedViaSpace = false;
    this.maxTimer = null;
    this.hotkeyIsDown = false;
    this.appInfo = null; // foreground app when recording started
    // chunk pipeline
    this.gen = 0;
    this.chunkTexts = [];
    this.chunkChain = Promise.resolve();
    this.chunkError = null;
    this.prevTail = '';
    this.sessionWavs = []; // raw chunk audio, kept so a failed dictation is recoverable
    this.stoppedAt = 0; // per-stage latency telemetry
    this.runtimeSettings = null; // config.json + regular app settings, fixed for this dictation
    this.pastingLastTranscript = false;
  }

  _sendOverlay(payload) {
    this.emit('ui-state', payload);
    const win = this.getOverlay();
    if (win && !win.isDestroyed()) win.webContents.send('session', payload);
  }

  uiState() {
    return { state: this.state, mode: this.mode };
  }

  _notifyHistoryChanged() {
    this.emit('history-changed');
  }

  _resetPipeline() {
    this.gen++;
    this.chunkTexts = [];
    this.chunkChain = Promise.resolve();
    this.chunkError = null;
    this.prevTail = '';
    this.sessionWavs = [];
    this.stoppedAt = 0;
  }

  _scheduleSystemAudioMute(settings) {
    clearTimeout(this.audioMuteTimer);
    this.audioMutedForSession = false;
    if (!settings.muteMusicWhileDictating || !this.systemAudio?.available) return;
    const generation = this.gen;
    // Let the start cue play first, then mute the host output endpoint.
    this.audioMuteTimer = setTimeout(async () => {
      if (this.state !== 'recording') return;
      const result = await this.systemAudio.mute();
      if (result?.ok && (this.state !== 'recording' || generation !== this.gen)) {
        await this.systemAudio.restore();
        return;
      }
      this.audioMutedForSession = !!result?.ok;
      if (!result?.ok) console.error('system audio mute:', result?.message || 'failed');
    }, 140);
  }

  async _restoreSystemAudio() {
    clearTimeout(this.audioMuteTimer);
    this.audioMuteTimer = null;
    if (!this.audioMutedForSession) return;
    this.audioMutedForSession = false;
    const result = await this.systemAudio.restore();
    if (!result?.ok) console.error('system audio restore:', result?.message || 'failed');
  }

  // The user's speech must survive a dead server: dump this session's audio to
  // disk so the words aren't simply gone. Returns the folder, or null.
  _saveFailedAudio() {
    if (!this.sessionWavs.length) return null;
    try {
      const dir = path.join(app.getPath('userData'), 'failed-audio');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.sessionWavs.forEach((buf, i) => {
        fs.writeFileSync(path.join(dir, `${stamp}-${i + 1}.wav`), buf);
      });
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.wav')).sort();
      // one dictation can span several chunk files; prune by leading timestamp
      const stamps = [...new Set(files.map((f) => f.replace(/-\d+\.wav$/, '')))];
      for (const old of stamps.slice(0, Math.max(0, stamps.length - FAILED_AUDIO_KEEP))) {
        for (const f of files.filter((n) => n.startsWith(old))) {
          try { fs.unlinkSync(path.join(dir, f)); } catch {}
        }
      }
      return dir;
    } catch (err) {
      console.error('failed-audio save:', err.message);
      return null;
    }
  }

  // ---- hotkey / key events -------------------------------------------------

  onPrimaryDown() {
    this.hotkeyIsDown = true;
    if (this.state === 'idle') {
      this.downAt = Date.now();
      this._startRecording('ptt');
    } else if (this.state === 'recording' && this.mode === 'handsfree') {
      // tapping the hotkey again ends a hands-free session
      this.stop();
    }
  }

  onPrimaryUp() {
    const wasDown = this.hotkeyIsDown;
    this.hotkeyIsDown = false;
    if (!wasDown || this.state !== 'recording' || this.mode !== 'ptt') return;
    const heldMs = Date.now() - this.downAt;
    if (heldMs < TAP_MS) {
      this.mode = 'handsfree';
      this._sendOverlay({ type: 'mode', mode: 'handsfree' });
    } else {
      this.stop();
    }
  }

  onSpace() {
    if (this.state !== 'recording') return;
    this.endedViaSpace = true;
    if (this.mode === 'ptt') {
      this.mode = 'handsfree';
      this._sendOverlay({ type: 'mode', mode: 'handsfree' });
      return;
    }
    this.stop();
  }

  onEscape() {
    if (this.state === 'recording') this.cancel();
  }

  // A non-combo key pressed right after the combo went down (e.g. Ctrl+Shift+T
  // when the hotkey is Ctrl+Shift): the user meant an app shortcut, not dictation.
  onIntrude() {
    if (this.state === 'recording' && this.mode === 'ptt' && Date.now() - this.downAt < INTRUDE_WINDOW_MS) {
      this.cancel();
    }
  }

  // ---- widget / tray / dashboard actions -----------------------------------

  toggle() {
    if (this.state === 'idle') this._startRecording('handsfree');
    else if (this.state === 'recording') this.stop();
  }

  async pasteLastTranscript() {
    if (this.state !== 'idle' || this.pastingLastTranscript) return false;
    const entry = this.store.history?.[0];
    const text = String(entry?.text || '');
    if (!text) {
      this._sendOverlay({ type: 'error', message: 'No dictation history yet' });
      return false;
    }

    this.pastingLastTranscript = true;
    try {
      const appInfo = await this.injector.foreground().catch(() => null);
      const result = await this.injector.pasteText(text, {
        restoreClipboard: !!this.store.settings?.restoreClipboard,
        shiftPaste: this.injector.isTerminalApp(appInfo)
      });
      if (!result.ok) console.error('paste last transcript failed:', result.message);
      const words = Number(entry.words) || text.trim().split(/\s+/u).filter(Boolean).length;
      this._sendOverlay({ type: 'done', words, pasted: result.ok, recovered: true });
      return result.ok;
    } catch (err) {
      console.error('paste last transcript failed:', err.message);
      this._sendOverlay({ type: 'error', message: 'Could not paste the last dictation' });
      return false;
    } finally {
      this.pastingLastTranscript = false;
    }
  }

  _startRecording(mode) {
    if (this.state !== 'idle') return;
    let settings;
    try {
      settings = this.getRuntimeSettings();
    } catch (err) {
      this._sendOverlay({ type: 'error', message: err.message });
      return;
    }
    this.state = 'recording';
    this.mode = mode;
    this.endedViaSpace = false;
    this._resetPipeline();
    this.runtimeSettings = settings;
    warmup(settings);
    polishWarmup(settings);
    this.appInfo = null;
    this.injector.foreground().then((info) => { this.appInfo = info; }).catch(() => {});
    this._sendOverlay({
      type: 'start',
      mode,
      micDeviceId: settings.micDeviceId,
      sounds: !!settings.sounds,
      fastMode: settings.fastMode !== false,
      autoStopSec: Number(settings.autoStopSec) || 0
    });
    this._scheduleSystemAudioMute(settings);
    clearTimeout(this.maxTimer);
    this.maxTimer = setTimeout(() => this.stop(), MAX_RECORD_MS);
  }

  stop() {
    if (this.state !== 'recording') return;
    clearTimeout(this.maxTimer);
    this.state = 'processing';
    this._restoreSystemAudio().finally(() => {
      if (this.state !== 'processing') return;
      this.stoppedAt = Date.now();
      this._sendOverlay({ type: 'processing' });
    });
    // overlay responds with onAudioData / onAudioError
  }

  cancel() {
    if (this.state === 'idle') return;
    clearTimeout(this.maxTimer);
    this.state = 'idle';
    this.gen++; // discard any in-flight chunk results
    this._restoreSystemAudio();
    this._sendOverlay({ type: 'cancel' });
  }

  // ---- chunk pipeline --------------------------------------------------------

  _enqueueChunk(wavArrayBuffer) {
    const gen = this.gen;
    const idx = this.chunkTexts.length;
    this.chunkTexts.push(null);
    const wavBuffer = Buffer.from(wavArrayBuffer);
    this.sessionWavs.push(wavBuffer);
    const settings = this.runtimeSettings;
    this.chunkChain = this.chunkChain.then(async () => {
      if (gen !== this.gen) return;
      try {
        const prompt = buildPrompt(settings, this.prevTail);
        const raw = await transcribe(wavBuffer, settings, { prompt });
        if (gen !== this.gen) return;
        const text = cleanArtifacts(raw);
        this.chunkTexts[idx] = text;
        if (text) {
          this.prevTail = text.slice(-200);
          // live caption while still recording
          if (this.state === 'recording') {
            this._sendOverlay({ type: 'partial', text: this.chunkTexts.filter(Boolean).join(' ') });
          }
        }
      } catch (err) {
        if (gen === this.gen && !this.chunkError) this.chunkError = err;
      }
    });
  }

  onAudioChunk(wavArrayBuffer) {
    if (this.state === 'recording' || this.state === 'processing') {
      this._enqueueChunk(wavArrayBuffer);
    }
  }

  _pickStyle(settings) {
    return pickStyle(this.appInfo, settings);
  }

  // ---- final audio arriving from the overlay renderer ------------------------

  async onAudioData(wavArrayBuffer, { durationMs, skip }) {
    if (this.state !== 'processing') return; // cancelled meanwhile
    const gen = this.gen;
    const endedViaSpace = this.endedViaSpace;
    this.endedViaSpace = false;

    const hadChunks = this.chunkTexts.length > 0;
    if (!hadChunks && (skip || !durationMs || durationMs < MIN_AUDIO_MS)) {
      this.state = 'idle';
      this._sendOverlay({ type: 'idle' });
      return;
    }

    if (!skip) this._enqueueChunk(wavArrayBuffer);
    await this.chunkChain;
    if (gen !== this.gen || this.state !== 'processing') return;
    const sttDoneAt = Date.now();

    if (this.chunkError) {
      this.state = 'idle';
      const saved = this._saveFailedAudio();
      this._sendOverlay({
        type: 'error',
        message: this.chunkError.message + (saved ? ' — audio saved to failed-audio' : '')
      });
      return;
    }

    const settings = this.runtimeSettings;
    let text = this.chunkTexts.filter(Boolean).join(' ');
    let polished = false;
    let rawText = ''; // pre-polish text, kept when fixes changed it (Insights diffs them)

    text = applyScratchThat(text);
    if (settings.spokenCommands !== false) text = applySpokenCommands(text);
    rawText = text;

    // A standalone trigger inserts verbatim. Inline triggers are masked while
    // the surrounding dictation is polished, then restored exactly afterward.
    const snippet = expandSnippets(text, settings.snippets);
    if (snippet.standalone) {
      text = snippet.text;
    } else {
      text = snippet.text;
      if (text) {
        this._sendOverlay({ type: 'status', text: 'Polishing…' });
        const result = await polishText(text, settings, this._pickStyle(settings));
        if (gen !== this.gen || this.state !== 'processing') return;
        if (snippetTokensPreserved(result.text, snippet.matches)) {
          text = result.text;
          polished = result.polished;
        } else {
          console.warn('polish removed a protected snippet token; using the unpolished transcript');
          text = snippet.text;
          polished = false;
        }
      }
      text = applyReplacements(text, replacementRules(settings));
      const restored = restoreSnippets(text, snippet.matches);
      if (!restored.complete) {
        text = restoreSnippets(snippet.text, snippet.matches).text;
        polished = false;
      } else {
        text = restored.text;
      }
    }

    if (!text) {
      this.state = 'idle';
      this._sendOverlay({ type: 'error', message: 'No speech detected' });
      return;
    }
    const polishDoneAt = Date.now();

    let pasted = false;
    if (settings.autoPaste) {
      const result = await this.injector.pasteText(text, {
        backspaceFirst: endedViaSpace && settings.compensateSpace,
        restoreClipboard: settings.restoreClipboard,
        shiftPaste: this.injector.isTerminalApp(this.appInfo)
      });
      pasted = result.ok;
      if (!result.ok) console.error('paste failed:', result.message);
    } else {
      const { clipboard } = require('electron');
      clipboard.writeText(text);
    }

    // where the post-release seconds went: transcription tail, polish, paste
    const latency = {
      sttMs: sttDoneAt - this.stoppedAt,
      polishMs: polishDoneAt - sttDoneAt,
      pasteMs: Date.now() - polishDoneAt,
      totalMs: Date.now() - this.stoppedAt
    };
    console.log(`dictation latency: stt=${latency.sttMs}ms polish=${latency.polishMs}ms paste=${latency.pasteMs}ms`);

    const entry = this.store.addTranscript({
      text,
      durationMs,
      mode: this.mode,
      app: this.appInfo?.app || '',
      polished,
      latency,
      raw: rawText && rawText !== text ? rawText : undefined
    });
    this._notifyHistoryChanged();
    this.emit('transcript-added', entry);

    this.state = 'idle';
    this._sendOverlay({ type: 'done', words: entry.words, pasted });
  }

  onAudioError(message) {
    clearTimeout(this.maxTimer);
    this.state = 'idle';
    this.gen++;
    this._restoreSystemAudio();
    this._sendOverlay({ type: 'error', message: message || 'Microphone error' });
  }
}

module.exports = { Session };
