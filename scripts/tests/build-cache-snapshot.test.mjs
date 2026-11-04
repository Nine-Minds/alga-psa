import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ARCHIVE_NAME, parseArguments, restore } from '../build-cache-snapshot.mjs';

// The snapshot tool shells out to `oras` and `tar`. What is worth pinning down
// here is the contract the workflow leans on: a restore never fails the build,
// only the named paths leave an archive, and the arguments cannot point outside
// the repository.

test('arguments name a tagged registry reference and repository-relative cache paths', () => {
  const options = parseArguments(['restore', '--reference', 'ghcr.io/nine-minds/alga-psa/build-cache:enterprise', '--path', 'server/node_modules/.cache/webpack', '--path', '.nx/cache']);
  assert.deepEqual(options, { command: 'restore', reference: 'ghcr.io/nine-minds/alga-psa/build-cache:enterprise', paths: ['server/node_modules/.cache/webpack', '.nx/cache'] });
  for (const argv of [
    ['prune', '--reference', 'ghcr.io/a/b:c', '--path', 'x'],
    ['save', '--path', 'x'],
    ['save', '--reference', 'ghcr.io/a/b', '--path', 'x'],
    ['save', '--reference', 'ghcr.io/a/b:c'],
    ['save', '--reference', 'ghcr.io/a/b:c', '--path', '/etc'],
    ['save', '--reference', 'ghcr.io/a/b:c', '--path', '../outside'],
    ['save', '--reference', 'ghcr.io/a/b:c', '--path', 'x', '--bogus', 'y'],
  ]) assert.throws(() => parseArguments(argv), argv.join(' '));
});

test('a restore that cannot pull leaves the build cold and reports it, without failing', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'build-cache-root-'));
  const output = path.join(root, 'github-output');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lines = [];
  // A PATH with no `oras` on it is the fork-pull-request case and the
  // misconfigured-runner case at once.
  const previous = process.env.PATH;
  process.env.PATH = root;
  try {
    const restored = restore({ reference: 'ghcr.io/nine-minds/alga-psa/build-cache:enterprise', paths: ['.nx/cache'], root, log: line => lines.push(line), output });
    assert.equal(restored, false);
  } finally { process.env.PATH = previous; }
  assert.match(lines[0], /no snapshot restored .* building cold/);
  assert.equal(readFileSync(output, 'utf8'), 'restored=false\n');
});

test('a restore extracts only the named members into the repository root', t => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'build-cache-fixture-'));
  const root = path.join(scratch, 'repo');
  const bin = path.join(scratch, 'bin');
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  mkdirSync(path.join(scratch, 'source', '.nx', 'cache'), { recursive: true });
  mkdirSync(path.join(scratch, 'source', 'other'), { recursive: true });
  mkdirSync(root); mkdirSync(bin);
  writeFileSync(path.join(scratch, 'source', '.nx', 'cache', 'entry'), 'cached');
  writeFileSync(path.join(scratch, 'source', 'other', 'stray'), 'must not land');
  const archive = path.join(scratch, ARCHIVE_NAME);
  const pack = spawnSync('tar', ['--zstd', '-cf', archive, '-C', path.join(scratch, 'source'), '.nx/cache', 'other'], { encoding: 'utf8' });
  if (pack.status !== 0) { t.skip(`tar --zstd unavailable: ${pack.stderr}`); return; }
  // A stand-in `oras` that "pulls" the fixture archive into the requested output directory.
  writeFileSync(path.join(bin, 'oras'), `#!/bin/sh\nout=""; while [ $# -gt 0 ]; do if [ "$1" = "--output" ]; then out="$2"; shift; fi; shift; done\ncp "${archive}" "$out/"\n`, { mode: 0o755 });
  const previous = process.env.PATH;
  process.env.PATH = `${bin}:${previous}`;
  const lines = [];
  try {
    assert.equal(restore({ reference: 'ghcr.io/nine-minds/alga-psa/build-cache:community', paths: ['.nx/cache'], root, log: line => lines.push(line), output: null }), true);
  } finally { process.env.PATH = previous; }
  assert.equal(readFileSync(path.join(root, '.nx', 'cache', 'entry'), 'utf8'), 'cached');
  assert.equal(existsSync(path.join(root, 'other')), false, 'members outside the named paths stay in the archive');
  assert.match(lines[0], /restored \d+ MB from ghcr\.io/);
});
