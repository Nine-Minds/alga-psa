/**
 * Filesystem timestamp helpers for the Microsoft Email smoke fixture and its
 * evidence capture.
 *
 * Node can only rewrite file timestamps through `fs.utimesSync`, which accepts
 * seconds as a double. That API restores timestamps faithfully to the
 * millisecond, but not to the nanosecond stored by filesystems such as Btrfs.
 * Whole milliseconds are therefore the finest fidelity a restoration can
 * guarantee, and the exactness gates compare restored directories at that
 * precision.
 */

import fs from 'node:fs';

/**
 * Truncate an `fs.Stats` millisecond timestamp to the whole-millisecond
 * fidelity that `fs.utimesSync` can faithfully restore.
 */
export function truncatedMtimeMs(stat) {
  return Math.trunc(stat.mtimeMs);
}

/**
 * Snapshot a directory's timestamps so they can be restored after the fixture
 * creates or deletes entries inside it. Returns null when the directory does
 * not exist (nothing will need restoring).
 */
export function directoryTimestampSnapshot(directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
    return null;
  }
  const stat = fs.statSync(directoryPath);
  return {
    path: directoryPath,
    atimeMs: stat.atimeMs,
    mtimeMs: stat.mtimeMs,
  };
}

/**
 * Restore a directory's timestamps from a snapshot, verifying the result at
 * millisecond fidelity.
 *
 * The double-seconds round trip through `fs.utimesSync` can drift by a few
 * hundred nanoseconds, which crosses a millisecond boundary only when the
 * original timestamp sat within that drift of the boundary. When that happens
 * the restoration retries with the middle of the original millisecond, which
 * is guaranteed to truncate identically.
 */
export function restoreDirectoryTimestamps(snapshot) {
  if (!snapshot) {
    return;
  }
  if (!fs.existsSync(snapshot.path)) {
    throw new Error(`Cannot restore timestamps because the directory is missing: ${snapshot.path}`);
  }
  fs.utimesSync(snapshot.path, snapshot.atimeMs / 1000, snapshot.mtimeMs / 1000);
  if (truncatedMtimeMs(fs.statSync(snapshot.path)) !== Math.trunc(snapshot.mtimeMs)) {
    fs.utimesSync(
      snapshot.path,
      (Math.trunc(snapshot.atimeMs) + 0.5) / 1000,
      (Math.trunc(snapshot.mtimeMs) + 0.5) / 1000
    );
  }
  if (truncatedMtimeMs(fs.statSync(snapshot.path)) !== Math.trunc(snapshot.mtimeMs)) {
    throw new Error(`Timestamp restoration failed for directory: ${snapshot.path}`);
  }
}
