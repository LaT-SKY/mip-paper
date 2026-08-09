import { spawn as nodeSpawn } from 'node:child_process';

export const PW_CAT_ARGS = Object.freeze([
  '--record',
  '--raw',
  '--rate=48000',
  '--channels=2',
  '--format=f32',
  '--latency=50ms',
  '--target=auto',
  '--properties',
  '{"stream.capture.sink":true,"media.role":"Music","node.name":"animated-ocean-wallpaper-spectrum"}',
  '-',
]);

export const PW_METADATA_ARGS = Object.freeze(['-m', '-n', 'default']);

const MAX_METADATA_LINE = 4096;
const SAFE_NODE_NAME = /^[A-Za-z0-9_.:-]{1,256}$/;

export function parseDefaultSinkLine(line) {
  if (typeof line !== 'string') return null;
  const match = line.match(/\bkey:'default\.audio\.sink'\s+value:'([^']*)'/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    return value && typeof value.name === 'string' && SAFE_NODE_NAME.test(value.name)
      ? value.name
      : null;
  } catch {
    return null;
  }
}

export function createMetadataLineDecoder(onSink) {
  if (typeof onSink !== 'function') throw new TypeError('onSink must be a function');
  let buffer = '';
  let discarding = false;

  return {
    push(chunk) {
      const text = String(chunk);
      let offset = 0;
      while (offset < text.length) {
        const newline = text.indexOf('\n', offset);
        const segmentEnd = newline < 0 ? text.length : newline;
        const segment = text.slice(offset, segmentEnd);
        if (!discarding) {
          buffer += segment;
          if (buffer.length > MAX_METADATA_LINE) {
            buffer = '';
            discarding = true;
          }
        }
        if (newline < 0) break;
        if (!discarding) {
          const sink = parseDefaultSinkLine(buffer.replace(/\r$/, ''));
          if (sink) onSink(sink);
        }
        buffer = '';
        discarding = false;
        offset = newline + 1;
      }
    },
    reset() {
      buffer = '';
      discarding = false;
    },
  };
}
