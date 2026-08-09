import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PW_CAT_ARGS,
  PW_METADATA_ARGS,
  createMetadataLineDecoder,
  parseDefaultSinkLine,
} from '../src/pipewire-audio.mjs';

function sinkLine(name) {
  return `update: id:0 key:'default.audio.sink' value:'${JSON.stringify({ name })}' type:'Spa:String:JSON'`;
}

test('uses fixed pw-cat arguments for sink capture', () => {
  assert.deepEqual(PW_CAT_ARGS, [
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
  assert.deepEqual(PW_METADATA_ARGS, ['-m', '-n', 'default']);
  assert.equal(Object.isFrozen(PW_CAT_ARGS), true);
  assert.equal(Object.isFrozen(PW_METADATA_ARGS), true);
});

test('parses only strict default audio sink JSON updates', () => {
  assert.equal(parseDefaultSinkLine(sinkLine('alsa_output.usb-test.stereo')), 'alsa_output.usb-test.stereo');
  for (const invalid of [
    "update: id:0 key:'default.audio.source' value:'{\"name\":\"mic\"}'",
    "update: id:0 key:'default.audio.sink' value:'not-json'",
    "update: id:0 key:'default.audio.sink' value:'{\"name\":\"bad name\"}'",
    "update: id:0 key:'default.audio.sink' value:'{\"name\":\"\"}'",
    "update: id:0 key:'default.audio.sink' value:'null'",
  ]) {
    assert.equal(parseDefaultSinkLine(invalid), null);
  }
});

test('reassembles metadata lines split across stdout chunks', () => {
  const names = [];
  const decoder = createMetadataLineDecoder((name) => names.push(name));
  const line = sinkLine('sink.one');
  decoder.push(line.slice(0, 37));
  decoder.push(`${line.slice(37)}\n${sinkLine('sink.two')}\n`);
  assert.deepEqual(names, ['sink.one', 'sink.two']);
});

test('drops overlong unfinished metadata lines and validates the listener', () => {
  const names = [];
  const decoder = createMetadataLineDecoder((name) => names.push(name));
  decoder.push('x'.repeat(4097));
  decoder.push(`\n${sinkLine('sink.after-overflow')}\n`);
  assert.deepEqual(names, ['sink.after-overflow']);
  assert.throws(() => createMetadataLineDecoder(), /onSink must be a function/);
});
