import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RECORDING_BYTES, RecordingError, RecordingSegment, listRecordingMetadata, pruneRecordings, recordingDirectory, recordingPlayback, recordingStats, verifyRecordingReceipt } from '../support-recordings.mjs';

const SESSION_ID = '22222222-2222-4222-8222-222222222222';

test('recording writes ordered events, fsyncs segments, and verifies a digest mismatch closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'support-recording-'));
  const segment = new RecordingSegment({ root, sessionId: SESSION_ID });
  segment.append('input', { data: 'ls\n' });
  segment.append('output', { data: 'ok\n' });
  segment.append('resize', { width: 100, height: 30 });
  const metadata = segment.finalize({ previousDigest: null });
  assert.equal(metadata.sessionId, SESSION_ID);
  assert.equal(metadata.bytes > 0, true);
  assert.equal(listRecordingMetadata(root, SESSION_ID).length, 1);
  assert.deepEqual(verifyRecordingReceipt(metadata, { ...metadata, signature: 'bad' }, 'not a key').valid, false);
  assert.throws(() => segment.append('input', { data: 'after close' }), (error) => error instanceof RecordingError && error.code === 'recording_closed');
});

test('recording paths reject traversal and retention removes only old finalized sessions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'support-retention-'));
  assert.throws(() => recordingDirectory(root, '../escape'), (error) => error.code === 'invalid_session_id');
  const old = new RecordingSegment({ root, sessionId: SESSION_ID, now: () => new Date(0) });
  old.finalize();
  const result = pruneRecordings(root, { nowMs: 31 * 24 * 60 * 60 * 1000 });
  assert.equal(result.removed, 1);
});

test('recording quota is shared across every segment in a session and playback decodes output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'support-recording-quota-'));
  const quota = { bytes: 0, limit: 1000 };
  const first = new RecordingSegment({ root, sessionId: SESSION_ID, quota });
  first.append('output', { data: 'first output' });
  first.finalize();
  const second = new RecordingSegment({ root, sessionId: SESSION_ID, quota });
  assert.throws(() => second.append('output', { data: 'x'.repeat(500) }), (error) => error instanceof RecordingError && error.code === 'recording_full');
  second.finalize();
  const stats = recordingStats(root, SESSION_ID);
  assert.equal(stats.segments.length, 2);
  const playback = recordingPlayback(root, SESSION_ID);
  assert.match(playback.text, /first output/);
  assert.equal(MAX_RECORDING_BYTES, 100 * 1024 * 1024);
});

test('recording ownership and chained playback preserve secure modes and chronology', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'support-recording-order-'));
  const first = new RecordingSegment({ root, sessionId: SESSION_ID, now: () => new Date(1000) });
  first.append('output', { data: 'first\n' });
  const firstMetadata = first.finalize();
  const second = new RecordingSegment({ root, sessionId: SESSION_ID, now: () => new Date(2000) });
  second.append('output', { data: 'second\n' });
  const secondMetadata = second.finalize({ previousDigest: firstMetadata.digest });
  const directory = recordingDirectory(root, SESSION_ID);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  const segmentStat = fs.statSync(path.join(directory, `segment-${firstMetadata.segmentId}.cast`));
  assert.equal(segmentStat.mode & 0o777, 0o600);
  assert.equal(segmentStat.uid, process.getuid());
  assert.equal(segmentStat.gid, process.getgid());
  assert.equal(secondMetadata.previousDigest, firstMetadata.digest);
  const playback = recordingPlayback(root, SESSION_ID);
  assert.equal(playback.text, 'first\nsecond\n');
});
