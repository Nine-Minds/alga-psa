#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// A `tree-<hash>` tag is only trustworthy if main's promotion job wrote it
// (see docs/plans/2026-10-31-trusted-tree-image-promotion.md). Anyone who can
// push a branch can push a tag, so the tag proves nothing. What a branch or a
// pull request cannot produce is an attestation whose certificate says the
// signing run was on refs/heads/main of this repository.
//
//   verify-trusted-tree-image.mjs verify <registry/repo/image> <tree> [--repo owner/repo]
//       Consumer check: resolve the tag, require the main attestation on that
//       digest, require the source-tree label to equal <tree>. Exit 0 only if
//       all three hold; any failure means "do not reuse, build instead".
//   <config JSON from `imagetools inspect --format '{{json .Image}}'`> |
//   verify-trusted-tree-image.mjs labels --tree <tree> --revision <sha>
//       Promotion check, before tagging.

export const SOURCE_TREE_LABEL = 'com.nineminds.source-tree';
export const REVISION_LABEL = 'org.opencontainers.image.revision';
export const PROMOTION_WORKFLOW = '.github/workflows/production-regression.yml';
export const TRUSTED_REF = 'refs/heads/main';
const treePattern = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;

// `imagetools inspect --format '{{json .Image}}'` prints the config for a
// single-platform manifest and a platform-keyed map for an index.
export function labelsOf(inspected) {
  const configs = inspected?.config || inspected?.Config ? [inspected] : Object.values(inspected ?? {});
  if (configs.length !== 1) throw new Error('Expected exactly one image config');
  return (configs[0].config ?? configs[0].Config)?.Labels ?? {};
}

export function assertSourceLabels(inspected, { tree, revision }) {
  if (!treePattern.test(tree ?? '')) throw new Error('A tree hash is required');
  const labels = labelsOf(inspected);
  if (labels[SOURCE_TREE_LABEL] !== tree) throw new Error(`Image source tree ${labels[SOURCE_TREE_LABEL] ?? '(none)'} is not ${tree}`);
  if (revision !== undefined && labels[REVISION_LABEL] !== revision) throw new Error(`Image revision ${labels[REVISION_LABEL] ?? '(none)'} is not ${revision}`);
}

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
};

export function verifyTrustedTreeImage({ reference, tree, repo, exec = run }) {
  if (!/^[a-z0-9.-]+(:\d+)?\/[a-z0-9._/-]+$/.test(reference ?? '')) throw new Error('A lowercase registry reference without tag is required');
  if (!treePattern.test(tree ?? '')) throw new Error('A tree hash is required');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? '')) throw new Error('A repository (owner/name) is required');
  const digest = exec('docker', ['buildx', 'imagetools', 'inspect', `${reference}:tree-${tree}`, '--format', '{{.Manifest.Digest}}']);
  if (!digestPattern.test(digest)) throw new Error(`Tag did not resolve to a digest: ${digest}`);
  // Signed by this repository's workflow, from main. A pull request run is
  // refs/pull/N/merge and a branch push refs/heads/<branch>.
  exec('gh', ['attestation', 'verify', `oci://${reference}@${digest}`, '--repo', repo,
    '--signer-workflow', `${repo}/${PROMOTION_WORKFLOW}`, '--source-ref', TRUSTED_REF]);
  assertSourceLabels(JSON.parse(exec('docker', ['buildx', 'imagetools', 'inspect', `${reference}@${digest}`, '--format', '{{json .Image}}'])), { tree });
  return digest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, ...rest] = process.argv.slice(2);
  const flag = name => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (mode === 'labels') {
      assertSourceLabels(JSON.parse(readFileSync(0, 'utf8')), { tree: flag('tree'), revision: flag('revision') });
      console.log('Image labels match the source tree and revision');
    } else if (mode === 'verify') {
      const digest = verifyTrustedTreeImage({ reference: rest[0], tree: rest[1], repo: flag('repo') ?? process.env.GITHUB_REPOSITORY });
      console.log(`${rest[0]}:tree-${rest[1]} is a trusted image: ${digest}`);
    } else throw new Error('Usage: verify <reference> <tree> [--repo owner/repo] | labels --tree <tree> --revision <sha>');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
