// Overlay widget: waveform pill + microphone capture (16 kHz mono WAV).
// In fast mode, long dictations are cut at natural pauses and streamed to the
// main process in chunks so transcription overlaps with speaking.
'use strict';

const pill = document.getElementById('pill');
const captionEl = document.getElementById('caption');
const waveCanvas = document.getElementById('wave');
const waveCtx = waveCanvas.getContext('2d');
const timerEl = document.getElementById('timer');
const msgText = document.getElementById('msg-text');
const idleLabel = document.getElementById('idle-label');

let uiState = 'idle';
let msgResetTimer = null;
let showFlowBar = true;
let waveRgb = { r: 232, g: 233, b: 235 };

// ---------------- audio capture ----------------

const TARGET_RATE = 16000;
// Silence detection is adaptive: a fixed threshold either never sees silence in
// a noisy room (no chunk cuts → fast mode degrades) or eats quiet speech.
// The floor tracks ambient level; "silence" is anything close to it.
const SILENCE_RMS_MIN = 0.006; // never call it speech below this
const SILENCE_RMS_MAX = 0.06; // never call it silence above this (loud rooms)
const NOISE_FLOOR_RATIO = 3; // speech must rise this far above the ambient floor
const CHUNK_MIN_MS = 4000; // don't cut before this much audio
const CHUNK_PAUSE_MS = 550; // silence needed to cut
const CHUNK_FORCE_MS = 25000; // cut even mid-speech (whisper context is ~30 s)
const PAD_SAMPLES = Math.round(0.25 * TARGET_RATE); // silence padding kept at trim edges

const rec = {
  ctx: null,
  stream: null,
  source: null,
  analyser: null,
  workletNode: null,
  scriptNode: null,
  chunks: [],
  startedAt: 0,
  active: false,
  sounds: true,
  fastMode: true,
  chunkMs: 0,
  silenceMs: 0,
  hadSpeech: false,
  mode: 'ptt',
  autoStopSec: 0,
  silenceRunMs: 0, // continuous silence, not reset by chunk cuts
  anySpeech: false,
  autoStopFired: false,
  noiseFloor: 0.01 // adaptive ambient level estimate
};

function silenceThreshold() {
  return Math.min(SILENCE_RMS_MAX, Math.max(SILENCE_RMS_MIN, rec.noiseFloor * NOISE_FLOOR_RATIO));
}

// Track the ambient floor: sink quickly toward quiet levels, creep up slowly so
// speech doesn't drag the floor with it.
function updateNoiseFloor(rms) {
  if (rms < rec.noiseFloor) rec.noiseFloor += (rms - rec.noiseFloor) * 0.3;
  else rec.noiseFloor += (rms - rec.noiseFloor) * 0.005;
  rec.noiseFloor = Math.min(rec.noiseFloor, SILENCE_RMS_MAX / NOISE_FLOOR_RATIO);
}

async function startCapture({ micDeviceId, sounds, fastMode, mode, autoStopSec }) {
  rec.sounds = sounds !== false;
  rec.fastMode = fastMode !== false;
  rec.mode = mode || 'ptt';
  rec.autoStopSec = Number(autoStopSec) || 0;
  rec.chunks = [];
  rec.chunkMs = 0;
  rec.silenceMs = 0;
  rec.hadSpeech = false;
  rec.silenceRunMs = 0;
  rec.anySpeech = false;
  rec.autoStopFired = false;
  rec.noiseFloor = 0.01;
  const constraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  };
  if (micDeviceId && micDeviceId !== 'default') {
    constraints.audio.deviceId = { exact: micDeviceId };
  }

  try {
    rec.stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (constraints.audio.deviceId) {
      // configured mic unplugged — fall back to default
      delete constraints.audio.deviceId;
      try {
        rec.stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err2) {
        throw new Error(micError(err2));
      }
    } else {
      throw new Error(micError(err));
    }
  }

  rec.ctx = new AudioContext({ sampleRate: TARGET_RATE });
  await rec.ctx.resume();
  rec.source = rec.ctx.createMediaStreamSource(rec.stream);

  rec.analyser = rec.ctx.createAnalyser();
  rec.analyser.fftSize = 512;
  rec.analyser.smoothingTimeConstant = 0.7;
  rec.source.connect(rec.analyser);

  try {
    await rec.ctx.audioWorklet.addModule('pcm-worklet.js');
    rec.workletNode = new AudioWorkletNode(rec.ctx, 'pcm-capture');
    rec.workletNode.port.onmessage = (e) => handleBatch(e.data);
    rec.source.connect(rec.workletNode);
  } catch {
    // fallback: deprecated but universally supported
    rec.scriptNode = rec.ctx.createScriptProcessor(4096, 1, 1);
    rec.scriptNode.onaudioprocess = (e) => handleBatch(new Float32Array(e.inputBuffer.getChannelData(0)));
    rec.source.connect(rec.scriptNode);
    rec.scriptNode.connect(rec.ctx.destination);
  }

  rec.active = true;
  rec.startedAt = performance.now();
  if (rec.sounds) beep(880, 0.06);
}

function handleBatch(f32) {
  if (!rec.active) return;
  rec.chunks.push(f32);

  const ms = (f32.length / TARGET_RATE) * 1000;
  rec.chunkMs += ms;
  let sum = 0;
  for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
  const rms = Math.sqrt(sum / f32.length);
  updateNoiseFloor(rms);
  if (rms < silenceThreshold()) {
    rec.silenceMs += ms;
    rec.silenceRunMs += ms;
  } else {
    rec.silenceMs = 0;
    rec.silenceRunMs = 0;
    rec.hadSpeech = true;
    rec.anySpeech = true;
  }

  // hands-free: end the session after a long pause (only once speech happened,
  // or after a generous grace period if the mic never picked anything up)
  if (rec.mode === 'handsfree' && rec.autoStopSec > 0 && !rec.autoStopFired) {
    const limit = rec.autoStopSec * 1000;
    if ((rec.anySpeech && rec.silenceRunMs >= limit) || (!rec.anySpeech && rec.silenceRunMs >= Math.max(limit * 2, 15000))) {
      rec.autoStopFired = true;
      window.vaani.overlayAction('stop');
      return;
    }
  }

  if (!rec.fastMode) return;
  if ((rec.chunkMs >= CHUNK_MIN_MS && rec.silenceMs >= CHUNK_PAUSE_MS) || rec.chunkMs >= CHUNK_FORCE_MS) {
    cutChunk();
  }
}

function concatChunks() {
  const total = rec.chunks.reduce((n, c) => n + c.length, 0);
  const pcm = new Float32Array(total);
  let off = 0;
  for (const c of rec.chunks) { pcm.set(c, off); off += c.length; }
  return pcm;
}

// Drop leading/trailing silence (keeps PAD_SAMPLES of padding) — smaller uploads,
// faster server-side inference. Returns empty array if it's all silence.
function trimSilence(pcm) {
  const threshold = silenceThreshold();
  const win = 320; // 20 ms
  let first = -1;
  let last = -1;
  for (let i = 0; i + win <= pcm.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += pcm[j] * pcm[j];
    if (Math.sqrt(sum / win) >= threshold) {
      if (first < 0) first = i;
      last = i + win;
    }
  }
  if (first < 0) return new Float32Array(0);
  return pcm.subarray(Math.max(0, first - PAD_SAMPLES), Math.min(pcm.length, last + PAD_SAMPLES));
}

function cutChunk() {
  const pcm = concatChunks();
  const hadSpeech = rec.hadSpeech;
  rec.chunks = [];
  rec.chunkMs = 0;
  rec.silenceMs = 0;
  rec.hadSpeech = false;
  if (!hadSpeech) return; // pure silence — nothing to transcribe
  const trimmed = trimSilence(pcm);
  if (trimmed.length < TARGET_RATE * 0.3) return;
  window.vaani.sendAudioChunk(encodeWav(trimmed, TARGET_RATE));
}

function micError(err) {
  if (err.name === 'NotAllowedError') return 'Microphone access denied';
  if (err.name === 'NotFoundError') return 'No microphone found';
  return `Microphone error: ${err.message || err.name}`;
}

function teardownCapture() {
  rec.active = false;
  try { rec.workletNode?.disconnect(); } catch {}
  try { rec.scriptNode?.disconnect(); } catch {}
  try { rec.source?.disconnect(); } catch {}
  try { rec.analyser?.disconnect(); } catch {}
  try { rec.stream?.getTracks().forEach((t) => t.stop()); } catch {}
  const ctx = rec.ctx;
  rec.ctx = null; rec.stream = null; rec.source = null;
  rec.analyser = null; rec.workletNode = null; rec.scriptNode = null;
  // close after beep has a chance to play
  if (ctx) setTimeout(() => ctx.close().catch(() => {}), 250);
}

function finishCapture() {
  const durationMs = performance.now() - rec.startedAt;
  if (rec.sounds && rec.ctx) beep(587, 0.06);
  rec.active = false;

  let pcm = concatChunks();
  rec.chunks = [];
  const trimmed = trimSilence(pcm);
  const skip = trimmed.length < TARGET_RATE * 0.25;

  teardownCapture();
  window.vaani.sendAudio(skip ? new ArrayBuffer(0) : encodeWav(trimmed, TARGET_RATE), { durationMs, skip });
}

function cancelCapture() {
  rec.chunks = [];
  teardownCapture();
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function beep(freq, dur) {
  try {
    const ctx = rec.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  } catch {}
}

// ---------------- waveform + timer ----------------

const BAR_COUNT = 36;
const levels = new Float32Array(BAR_COUNT);
let rafId = null;
let analyserBuf = null;

function drawLoop() {
  rafId = requestAnimationFrame(drawLoop);

  // shift bars left, append current level
  let level = 0;
  if (rec.analyser) {
    if (!analyserBuf || analyserBuf.length !== rec.analyser.fftSize) {
      analyserBuf = new Float32Array(rec.analyser.fftSize);
    }
    rec.analyser.getFloatTimeDomainData(analyserBuf);
    let sum = 0;
    for (let i = 0; i < analyserBuf.length; i++) sum += analyserBuf[i] * analyserBuf[i];
    level = Math.min(1, Math.sqrt(sum / analyserBuf.length) * 4.5);
  }
  levels.copyWithin(0, 1);
  levels[BAR_COUNT - 1] = level;

  const w = waveCanvas.width;
  const h = waveCanvas.height;
  waveCtx.clearRect(0, 0, w, h);
  const gap = 3;
  const bw = (w - gap * (BAR_COUNT - 1)) / BAR_COUNT;
  for (let i = 0; i < BAR_COUNT; i++) {
    const amp = Math.max(0.06, levels[i]);
    const bh = Math.max(3, amp * (h - 8));
    const x = i * (bw + gap);
    const y = (h - bh) / 2;
    const alpha = 0.3 + 0.65 * (i / BAR_COUNT);
    waveCtx.fillStyle = `rgba(${waveRgb.r}, ${waveRgb.g}, ${waveRgb.b}, ${alpha.toFixed(2)})`;
    roundBar(waveCtx, x, y, bw, bh, bw / 2);
  }

  if (rec.startedAt && rec.active) {
    const s = Math.floor((performance.now() - rec.startedAt) / 1000);
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}

function roundBar(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function stopDrawLoop() {
  cancelAnimationFrame(rafId);
  rafId = null;
  levels.fill(0);
}

// ---------------- UI state ----------------

function setState(state) {
  uiState = state;
  pill.className = `state-${state}`;
  document.body.classList.toggle('flow-bar-hidden', !showFlowBar && state === 'idle');
  clearTimeout(msgResetTimer);
  if (state === 'recording') {
    timerEl.textContent = '0:00';
    if (!rafId) drawLoop();
  } else {
    stopDrawLoop();
    // pill geometry changed — release mouse capture so we never block clicks
    // through the (now mostly empty) window; hovering again re-enables it
    window.vaani.setHover(false);
  }
}

async function refreshOverlayPreferences() {
  try {
    const result = await window.vaani.getSettings();
    showFlowBar = result.settings.showFlowBar !== false;
    const accent = /^#[0-9a-f]{6}$/i.test(String(result.settings.accentColor || ''))
      ? result.settings.accentColor
      : '#e8e9eb';
    waveRgb = {
      r: parseInt(accent.slice(1, 3), 16),
      g: parseInt(accent.slice(3, 5), 16),
      b: parseInt(accent.slice(5, 7), 16)
    };
    const luma = waveRgb.r * 0.299 + waveRgb.g * 0.587 + waveRgb.b * 0.114;
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-text', luma > 150 ? '#101113' : '#ffffff');
    document.body.dataset.position = result.settings.overlayPosition || 'bottom-center';
    document.body.classList.toggle('flow-bar-hidden', !showFlowBar && uiState === 'idle');
  } catch {}
}

window.vaani.onSettingsChanged(refreshOverlayPreferences);
window.vaani.onOverlayPosition((position) => { document.body.dataset.position = position; });
refreshOverlayPreferences();

function flashMessage(state, text, ms) {
  setState(state);
  msgText.textContent = text;
  msgResetTimer = setTimeout(() => setState('idle'), ms);
}

function setCaption(text) {
  if (text) {
    captionEl.textContent = text.length > 220 ? '…' + text.slice(-220) : text;
    captionEl.hidden = false;
  } else {
    captionEl.hidden = true;
    captionEl.textContent = '';
  }
}

// ---------------- session events from main ----------------

let capturePromise = null;

window.vaani.onSession(async (msg) => {
  switch (msg.type) {
    case 'start':
      setCaption(null);
      setState('recording');
      idleLabel.textContent = 'Start dictating';
      capturePromise = startCapture(msg);
      try {
        await capturePromise;
      } catch (err) {
        window.vaani.sendAudioError(err.message);
      }
      break;
    case 'mode':
      rec.mode = msg.mode || 'handsfree';
      break;
    case 'partial':
      if (uiState === 'recording' || uiState === 'processing') setCaption(msg.text);
      break;
    case 'status':
      if (uiState === 'processing') msgText.textContent = msg.text || 'Working…';
      break;
    case 'processing':
      setState('processing');
      msgText.textContent = 'Transcribing…';
      // a fast PTT release can land before getUserMedia resolves — wait it out
      if (capturePromise) { try { await capturePromise; } catch {} }
      if (rec.stream) finishCapture();
      else window.vaani.sendAudioError('Recording was not active');
      break;
    case 'cancel':
      cancelCapture();
      setCaption(null);
      setState('idle');
      break;
    case 'done':
      setCaption(null);
      flashMessage('done', `${msg.words} word${msg.words === 1 ? '' : 's'}${msg.pasted ? '' : ' (copied)'}`, 1600);
      break;
    case 'error':
      cancelCapture();
      setCaption(null);
      flashMessage('error', msg.message || 'Something went wrong', 3200);
      break;
    case 'idle':
      cancelCapture();
      setCaption(null);
      setState('idle');
      break;
  }
});

// ---------------- mouse interaction ----------------

// Window is click-through by default; enable input only while over the pill.
pill.addEventListener('mouseenter', () => window.vaani.setHover(true));
pill.addEventListener('mouseleave', () => {
  if (!dragGesture?.active) window.vaani.setHover(false);
});

let dragGesture = null;
let dragMoveRaf = null;
let pendingDragPoint = null;
let suppressClick = false;

function pointerPoint(event) {
  return { screenX: event.screenX, screenY: event.screenY };
}

function queueDragMove(point) {
  pendingDragPoint = point;
  if (dragMoveRaf) return;
  dragMoveRaf = requestAnimationFrame(() => {
    dragMoveRaf = null;
    if (pendingDragPoint) window.vaani.moveOverlayDrag(pendingDragPoint);
    pendingDragPoint = null;
  });
}

function endDragGesture(event) {
  if (!dragGesture || event.pointerId !== dragGesture.pointerId) return;
  const point = pointerPoint(event);
  if (dragMoveRaf) cancelAnimationFrame(dragMoveRaf);
  dragMoveRaf = null;
  pendingDragPoint = null;
  if (dragGesture.active) {
    window.vaani.moveOverlayDrag(point);
    window.vaani.endOverlayDrag(point);
    document.body.classList.remove('is-dragging');
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }
  try { pill.releasePointerCapture(event.pointerId); } catch {}
  dragGesture = null;
}

pill.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('button')) return;
  dragGesture = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    active: false
  };
  pill.setPointerCapture(event.pointerId);
});

pill.addEventListener('pointermove', (event) => {
  if (!dragGesture || event.pointerId !== dragGesture.pointerId) return;
  if (!dragGesture.active) {
    const distance = Math.hypot(event.screenX - dragGesture.startX, event.screenY - dragGesture.startY);
    if (distance < 6) return;
    dragGesture.active = true;
    suppressClick = true;
    document.body.classList.add('is-dragging');
    window.vaani.beginOverlayDrag(pointerPoint(event));
  }
  queueDragMove(pointerPoint(event));
});

pill.addEventListener('pointerup', endDragGesture);
pill.addEventListener('pointercancel', endDragGesture);

pill.addEventListener('click', (e) => {
  if (suppressClick) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (uiState === 'idle') window.vaani.overlayAction('toggle');
});
document.getElementById('btn-stop').addEventListener('click', (e) => {
  e.stopPropagation();
  window.vaani.overlayAction('stop');
});
document.getElementById('btn-cancel').addEventListener('click', (e) => {
  e.stopPropagation();
  window.vaani.overlayAction('cancel');
});
