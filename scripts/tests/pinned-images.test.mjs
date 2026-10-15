import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { parsePinnedImages, pinnedImage, pinnedImages } from '../lib/pinned-images.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRAGMENT = 'docker-compose.images.yaml';
const PINNED = /^[a-z0-9][a-z0-9._\-/]*:[A-Za-z0-9_][A-Za-z0-9._-]*@sha256:[0-9a-f]{64}$/;

// The literals are assembled so this file does not match its own search.
const RETIRED_IMAGE = ['ankane', 'pgvector'].join('/');
const PINNED_IMAGE_PREFIX = `${['pgvector', 'pgvector'].join('/')}:`;

// Plan directories document history and may name the old image.
const PLAN_DIRS = [':!docs/plans', ':!ee/docs/plans'];

function trackedFilesContaining(literal, excludes) {
  try {
    const out = execFileSync(
      'git',
      ['grep', '--untracked', '-I', '-l', '-F', '-e', literal, '--', ...excludes],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    return out.split('\n').filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

test('the pinned image fragment parses and every ref is name:tag@sha256:<64 hex>', () => {
  const images = pinnedImages();
  assert.ok(Object.keys(images).length > 0);
  for (const [key, ref] of Object.entries(images)) {
    assert.match(ref, PINNED, `${key} must be digest pinned`);
  }
  assert.equal(pinnedImage('pgvector'), images.pgvector);
});

test('the resolver rejects fragments that are not exactly pinned', () => {
  const digest = 'a'.repeat(64);
  const good = `services:\n  db:\n    image: \${DB_IMAGE:-example/db:1.0@sha256:${digest}}\n`;
  assert.deepEqual(parsePinnedImages(good, 'good.yaml'), { db: `example/db:1.0@sha256:${digest}` });
  for (const image of [
    'example/db:latest',
    `\${DB_IMAGE:-example/db:latest}`,
    `\${DB_IMAGE:-example/db@sha256:${digest}}`,
    `\${DB_IMAGE:-example/db:1.0@sha256:${'a'.repeat(63)}}`,
    `example/db:1.0@sha256:${digest}`,
  ]) {
    assert.throws(
      () => parsePinnedImages(`services:\n  db:\n    image: ${image}\n`, 'bad.yaml'),
      /bad\.yaml:3/,
      image,
    );
  }
  assert.throws(() => pinnedImage('missing'), /No pinned image "missing"/);
});

test('no tracked file outside the plan directories references the retired image', () => {
  assert.deepEqual(trackedFilesContaining(RETIRED_IMAGE, PLAN_DIRS), []);
});

test('only the fragment carries a literal pinned image ref', () => {
  const offenders = trackedFilesContaining(PINNED_IMAGE_PREFIX, [...PLAN_DIRS, `:!${FRAGMENT}`]);
  assert.deepEqual(offenders, [], 'Reference the image through docker-compose.images.yaml instead of copying it');
});

test('Helm values copies recompose to exactly the pinned ref', () => {
  const expected = pinnedImage('pgvector');
  // helm/values.yaml repeats a top-level key elsewhere; Helm tolerates that, so do we.
  const alga = parse(readFileSync(path.join(repoRoot, 'helm', 'values.yaml'), 'utf8'), { uniqueKeys: false });
  const { repository, tag, digest } = alga.db.image;
  assert.equal(`${repository}:${tag}@${digest}`, expected, 'helm/values.yaml db.image');

  const email = parse(readFileSync(path.join(repoRoot, 'ee', 'helm', 'email-service', 'values.yaml'), 'utf8'));
  const wait = email.waitForBootstrap.image;
  assert.equal(`${wait.name}:${wait.tag}@${wait.digest}`, expected, 'email-service waitForBootstrap.image');
});
