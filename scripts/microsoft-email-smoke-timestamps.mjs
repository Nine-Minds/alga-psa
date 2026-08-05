/**
 * Filesystem timestamp helpers for the Microsoft Email smoke fixture and its
 * evidence capture.
 *
 * Node can only rewrite file timestamps through `fs.utimesSync`, which accepts
 * seconds as a double. That API restores atime/mtime faithfully to the
 * millisecond, but not to the nanosecond stored by filesystems such as Btrfs.
 * Whole milliseconds are therefore the finest fidelity a restoration can
 * guarantee, and the exactness gates compare restored directories at that
 * precision.
 *
 * ctime (the inode change time) is different: it is kernel-managed and cannot
 * be set from userspace at all, so any fixture create/delete inside a mutated
 * directory bumps that directory's ctime irreversibly. The inventory and the
 * snapshot therefore record ctime so the harness can disclose the delta, but
 * the exactness gate never requires it to be restored.
 */

import fs from 'node:fs';
import path from 'node:path';

export const CTIME_NON_RESTORABLE_REASON =
  'ctime is kernel-managed; not restorable from userspace';

/**
 * Truncate an `fs.Stats` millisecond timestamp to the whole-millisecond
 * fidelity that `fs.utimesSync` can faithfully restore.
 */
export function truncatedMtimeMs(stat) {
  return Math.trunc(stat.mtimeMs);
}

/**
 * Snapshot a directory's timestamps so atime/mtime can be restored after the
 * fixture creates or deletes entries inside it. Returns null when the
 * directory does not exist (nothing will need restoring).
 *
 * `ctimeMs` is recorded for disclosure only: the fixture churn that makes the
 * snapshot necessary also moves the directory's ctime, which `fs.utimesSync`
 * cannot restore. Keeping it on the snapshot makes the mutation visible to
 * anyone reading the fixture state instead of silently losing it.
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
    ctimeMs: stat.ctimeMs,
  };
}

/**
 * Project a secret inventory onto its restorable fields so the exactness gate
 * can compare exactly what the fixture must restore: content hashes, names,
 * sizes, modes, per-file mtime, and the tenant directory's whole-millisecond
 * mtime. ctime fields are dropped here because they cannot be restored; they
 * are compared and disclosed separately by `ctimeDisclosure`.
 */
export function restorableInventory(inventory) {
  const { directoryCtimeMs, parentDirectoryCtimeMs, ...rest } = inventory;
  return {
    ...rest,
    files: inventory.files.map(({ ctimeMs, ...fileRest }) => fileRest),
  };
}

/**
 * Compute the structured ctime disclosure between a before and after secret
 * inventory.
 *
 * ctime is kernel-managed and not restorable from userspace, so a ctime delta
 * is expected and disclosed where the fixture actually mutated a directory:
 * the tenant secret directory when it pre-existed (the fixture writes then
 * deletes its secret inside it), otherwise the parent directory (the fixture
 * creates then removes the tenant directory). Every other path — untouched
 * pre-existing secret files, and the parent when the tenant directory already
 * existed — must keep its ctime; a change there is an `unexpectedChanges`
 * entry that fails the gate.
 */
export function ctimeDisclosure(baseline, after) {
  const paths = [];
  const changedPaths = [];
  const unexpectedChanges = [];

  function compare(pathName, kind, expected, baselineCtimeMs, afterCtimeMs) {
    const changed = baselineCtimeMs !== afterCtimeMs;
    paths.push({
      path: pathName,
      kind,
      expected,
      baselineCtimeMs,
      afterCtimeMs,
      changed,
    });
    if (changed) {
      changedPaths.push(pathName);
      if (!expected) {
        unexpectedChanges.push(pathName);
      }
    }
  }

  const tenantPath = baseline.tenantDirectory || after.tenantDirectory || '';
  const tenantPreExisted = baseline.directoryExists === true;

  if (baseline.parentDirectoryCtimeMs != null && after.parentDirectoryCtimeMs != null) {
    compare(
      path.dirname(tenantPath),
      'directory',
      !tenantPreExisted,
      baseline.parentDirectoryCtimeMs,
      after.parentDirectoryCtimeMs
    );
  }
  if (baseline.directoryCtimeMs != null && after.directoryCtimeMs != null) {
    compare(
      tenantPath,
      'directory',
      tenantPreExisted,
      baseline.directoryCtimeMs,
      after.directoryCtimeMs
    );
  }

  const afterFilesByName = new Map(after.files.map((file) => [file.name, file]));
  for (const file of baseline.files) {
    const afterFile = afterFilesByName.get(file.name);
    if (!afterFile) {
      continue;
    }
    compare(file.name, 'file', false, file.ctimeMs, afterFile.ctimeMs);
  }

  return {
    reason: CTIME_NON_RESTORABLE_REASON,
    paths,
    changedPaths,
    unexpectedChanges,
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
