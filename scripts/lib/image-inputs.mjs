// The inputs of a fresh-install image, hashed from git tree objects. Two
// revisions with the same input hash for an image would build byte-identical
// contexts, so the earlier build may stand in for the later one. The policy
// file is the reviewable statement of what each image is built from.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const IMAGE_POLICY_PATH = 'scripts/image-inputs.json';

export function loadImagePolicy(root) {
  const policy = JSON.parse(readFileSync(path.join(root, IMAGE_POLICY_PATH), 'utf8'));
  if (policy.schemaVersion !== 1 || !policy.images || !Array.isArray(policy.exclude) || !Array.isArray(policy.always)) {
    throw new Error('Unsupported image inputs policy');
  }
  return policy;
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

/** Make a revision available locally (shallow checkouts lack other commits). */
export function ensureCommit({ cwd, revision, remote = 'origin' }) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('A full commit hash is required');
  const probe = spawnSync('git', ['cat-file', '-e', `${revision}^{commit}`], { cwd });
  if (probe.status === 0) return;
  git(cwd, ['fetch', '--quiet', '--depth=1', remote, revision]);
}

const matches = (file, prefix) => prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix;

/** Which repository paths count as inputs for `service`. */
export function selectImageInputs({ files, policy, service }) {
  const image = policy.images?.[service];
  if (!image) throw new Error(`No image inputs policy for ${service}`);
  const includes = [...image.include, image.dockerfile, ...policy.always];
  const whole = image.include.length === 0;
  return files.filter(file => {
    if (policy.exclude.some(prefix => matches(file, prefix)) && !policy.always.some(prefix => matches(file, prefix)) && file !== image.dockerfile) return false;
    return whole || includes.some(prefix => matches(file, prefix));
  });
}

/** sha256 over the sorted (mode, blob, path) triples of the image's inputs at `revision`. */
export function imageInputsHash({ cwd, revision, service, policy }) {
  const listing = git(cwd, ['ls-tree', '-r', '--full-tree', '--end-of-options', revision]);
  const entries = new Map();
  for (const line of listing.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    const [mode, , blob] = line.slice(0, tab).split(' ');
    entries.set(line.slice(tab + 1), `${mode} ${blob}`);
  }
  const selected = selectImageInputs({ files: [...entries.keys()], policy, service }).sort();
  const hash = createHash('sha256');
  for (const file of selected) hash.update(`${entries.get(file)} ${file}\n`);
  return { sha256: `sha256:${hash.digest('hex')}`, files: selected.length };
}
