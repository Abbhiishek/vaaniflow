// Dictation session state machine.
//
//   idle ──hotkey down──▶ recording(ptt)
//     recording: released within TAP_MS  ──▶ recording(handsfree)
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
const { EventEmitter } = require('events');
const { transcribe, warmup } = require('./transcriber');
const { polishText } = require('./polisher');
const {
  cleanArtifacts,
  applyReplacements,
  applyScratchThat,
  applySpokenCommands,
  expandSnippets,
  buildPrompt
} = require('./postprocess');

const TAP_MS = 350; // held shorter than this = "tap" → hands-free mode
const MIN_AUDIO_MS = 350; // discard blips shorter than this
const MAX_RECORD_MS = 5 * 60 * 1000;
const INTRUDE_WINDOW_MS = 700; // other key right after combo-down = app shortcut, not dictation

class Session extends EventEmitter {
  constructor({ store, injector, getOverlay }) {
    super();
    this.store = store;
    this.injector = injector;
    this.getOverlay = getOverlay;
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
  }

  _sendOverlay(payload) {
    const win = this.getOverlay();
    if (win && !win.isDestroyed()) win.webContents.send('session', payload);
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
    if (this.state === 'recording' && this.mode === 'handsfree') {
      this.endedViaSpace = true;
      this.stop();
    }
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

  _startRecording(mode) {
    if (this.state !== 'idle') return;
    this.state = 'recording';
    this.mode = mode;
    this.endedViaSpace = false;
    this._resetPipeline();
    const s = this.store.settings;
    warmup(s);
    this.appInfo = null;
    this.injector.foreground().then((info) => { this.appInfo = info; }).catch(() => {});
    this._sendOverlay({
      type: 'start',
      mode,
      micDeviceId: s.micDeviceId,
      sounds: !!s.sounds,
      fastMode: s.fastMode !== false,
      autoStopSec: Number(s.autoStopSec) || 0
    });
    clearTimeout(this.maxTimer);
    this.maxTimer = setTimeout(() => this.stop(), MAX_RECORD_MS);
  }

  stop() {
    if (this.state !== 'recording') return;
    clearTimeout(this.maxTimer);
    this.state = 'processing';
    this._sendOverlay({ type: 'processing' });
    // overlay responds with onAudioData / onAudioError
  }

  cancel() {
    if (this.state === 'idle') return;
    clearTimeout(this.maxTimer);
    this.state = 'idle';
    this.gen++; // discard any in-flight chunk results
    this._sendOverlay({ type: 'cancel' });
  }

  // ---- chunk pipeline --------------------------------------------------------

  _enqueueChunk(wavArrayBuffer) {
    const gen = this.gen;
    const idx = this.chunkTexts.length;
    this.chunkTexts.push(null);
    const settings = this.store.settings;
    this.chunkChain = this.chunkChain.then(async () => {
      if (gen !== this.gen) return;
      try {
        const prompt = buildPrompt(settings.vocabulary, this.prevTail);
        const raw = await transcribe(Buffer.from(wavArrayBuffer), settings, { prompt });
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

  _pickTone(settings) {
    const hay = `${this.appInfo?.app || ''} ${this.appInfo?.title || ''}`.toLowerCase();
    for (const p of settings.appProfiles || []) {
      const match = String(p?.match || '').toLowerCase().trim();
      if (match && hay.includes(match)) return p.tone || 'neutral';
    }
    return settings.defaultTone || 'neutral';
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

    if (this.chunkError) {
      this.state = 'idle';
      this._sendOverlay({ type: 'error', message: this.chunkError.message });
      return;
    }

    const settings = this.store.settings;
    let text = this.chunkTexts.filter(Boolean).join(' ');
    let polished = false;

    // whole utterance is a snippet trigger → insert the snippet verbatim
    const snippet = expandSnippets(text, settings.snippets);
    if (snippet.matched) {
      text = snippet.text;
    } else {
      text = applyScratchThat(text);
      if (settings.spokenCommands !== false) text = applySpokenCommands(text);
      if (text) {
        this._sendOverlay({ type: 'status', text: 'Polishing…' });
        const result = await polishText(text, settings, this._pickTone(settings));
        if (gen !== this.gen || this.state !== 'processing') return;
        text = result.text;
        polished = result.polished;
      }
      text = applyReplacements(text, settings.replacements);
    }

    if (!text) {
      this.state = 'idle';
      this._sendOverlay({ type: 'error', message: 'No speech detected' });
      return;
    }

    const entry = this.store.addTranscript({
      text,
      durationMs,
      mode: this.mode,
      app: this.appInfo?.app || '',
      polished
    });
    this._notifyHistoryChanged();

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

    this.state = 'idle';
    this._sendOverlay({ type: 'done', words: entry.words, pasted });
  }

  onAudioError(message) {
    clearTimeout(this.maxTimer);
    this.state = 'idle';
    this.gen++;
    this._sendOverlay({ type: 'error', message: message || 'Microphone error' });
  }
}

module.exports = { Session };
