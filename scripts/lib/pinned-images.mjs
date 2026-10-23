#!/usr/bin/env node
// Resolver for docker-compose.images.yaml, the single source of truth for pinned
// third-party images. Dependency-free on purpose: CI calls it from a sparse
// checkout without `npm ci`.
//
//   node scripts/lib/pinned-images.mjs pgvector          -> prints the image ref
//   node scripts/lib/pinned-images.mjs --github-output   -> prints `key=ref` lines
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const IMAGES_FILE = path.join(repoRoot, 'docker-compose.images.yaml');

const SERVICE_KEY = /^ {2}([A-Za-z0-9][A-Za-z0-9_-]*):\s*$/;
const IMAGE_LINE = /^ {4}image:\s*(.*?)\s*$/;
const IMAGE_VALUE = /^\$\{([A-Z][A-Z0-9_]*):-(.+)\}$/;
const PINNED_REF = /^[a-z0-9][a-z0-9._\-/]*:[A-Za-z0-9_][A-Za-z0-9._-]*@sha256:[0-9a-f]{64}$/;

export function parsePinnedImages(text, source = IMAGES_FILE) {
  const images = {};
  let inServices = false;
  let service = null;
  for (const [index, line] of text.split('\n').entries()) {
    const where = `${source}:${index + 1}`;
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (/^\S/.test(line) && !line.startsWith('#')) inServices = false;
    if (!inServices) continue;
    const serviceMatch = SERVICE_KEY.exec(line);
    if (serviceMatch) {
      service = serviceMatch[1];
      continue;
    }
    const imageMatch = IMAGE_LINE.exec(line);
    if (!imageMatch) continue;
    if (service === null) throw new Error(`${where}: image outside of a service`);
    if (service in images) throw new Error(`${where}: service ${service} declares image twice`);
    const valueMatch = IMAGE_VALUE.exec(imageMatch[1]);
    if (!valueMatch) {
      throw new Error(`${where}: image for ${service} must have the exact shape \${VAR:-name:tag@sha256:<64 hex>}`);
    }
    if (!PINNED_REF.test(valueMatch[2])) {
      throw new Error(`${where}: image ref for ${service} must be name:tag@sha256:<64 hex>, got ${valueMatch[2]}`);
    }
    images[service] = valueMatch[2];
  }
  if (Object.keys(images).length === 0) throw new Error(`${source}: no pinned images found`);
  return images;
}

export function pinnedImages(file = IMAGES_FILE) {
  return parsePinnedImages(readFileSync(file, 'utf8'), file);
}

export function pinnedImage(key, file = IMAGES_FILE) {
  const images = pinnedImages(file);
  if (!(key in images)) {
    throw new Error(`No pinned image "${key}" in ${file}; known: ${Object.keys(images).join(', ')}`);
  }
  return images[key];
}

function main(argv) {
  const [arg] = argv;
  if (argv.length !== 1) throw new Error('usage: pinned-images.mjs <key> | --github-output');
  if (arg === '--github-output') {
    for (const [key, ref] of Object.entries(pinnedImages())) process.stdout.write(`${key}=${ref}\n`);
    return;
  }
  process.stdout.write(`${pinnedImage(arg)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
