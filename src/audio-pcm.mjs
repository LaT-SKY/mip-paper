const BYTES_PER_FRAME = 8;

export function createPcmFrameDecoder(onFrames) {
  if (typeof onFrames !== 'function') {
    throw new TypeError('onFrames must be a function');
  }

  let tail = Buffer.alloc(0);
  let invalidFrames = 0;

  return {
    push(chunk) {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const bytes = tail.length ? Buffer.concat([tail, incoming]) : incoming;
      const completeBytes = bytes.length - (bytes.length % BYTES_PER_FRAME);
      tail = Buffer.from(bytes.subarray(completeBytes));
      const left = [];
      const right = [];

      for (let offset = 0; offset < completeBytes; offset += BYTES_PER_FRAME) {
        const leftSample = bytes.readFloatLE(offset);
        const rightSample = bytes.readFloatLE(offset + 4);
        if (!Number.isFinite(leftSample) || !Number.isFinite(rightSample)) {
          invalidFrames += 1;
          continue;
        }
        left.push(leftSample);
        right.push(rightSample);
      }

      if (left.length > 0) {
        onFrames(Float32Array.from(left), Float32Array.from(right));
      }
    },
    reset() {
      tail = Buffer.alloc(0);
    },
    get invalidFrames() {
      return invalidFrames;
    },
  };
}
