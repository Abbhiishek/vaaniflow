// AudioWorklet: batches mono PCM frames and posts them to the main thread.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const ch = input[0];
      let i = 0;
      while (i < ch.length) {
        const n = Math.min(ch.length - i, this.buffer.length - this.offset);
        this.buffer.set(ch.subarray(i, i + n), this.offset);
        this.offset += n;
        i += n;
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer.slice());
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
