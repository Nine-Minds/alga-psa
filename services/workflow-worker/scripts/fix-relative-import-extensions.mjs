#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVICE_ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(SERVICE_ROOT, 'dist');
const JS_FILE_RE = /\.(?:c|m)?js$/i;

function isRelative(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function resolveSuffix(fromFile, specifier) {
  if (!isRelative(specifier) || path.extname(specifier)) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  const rawPath = path.resolve(fromDir, specifier);

  const candidates = [
    { abs: `${rawPath}.js`, suffix: '.js' },
    { abs: `${rawPath}.mjs`, suffix: '.mjs' },
    { abs: `${rawPath}.cjs`, suffix: '.cjs' },
    { abs: path.join(rawPath, 'index.js'), suffix: '/index.js' },
    { abs: path.join(rawPath, 'index.mjs'), suffix: '/index.mjs' },
    { abs: path.join(rawPath, 'index.cjs'), suffix: '/index.cjs' },
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate.abs)) {
      return candidate.suffix;
    }
  }

  return null;
}

function rewriteSource(filePath, source) {
  let updated = source;
  let changed = false;

  const staticImportRe =
    /((?:import|export)\s+(?:[^'"]*?\sfrom\s*)?)(['"])([^'"]+)(\2)/g;
  const dynamicImportRe = /(import\(\s*)(['"])([^'"]+)(\2)(\s*\))/g;

  updated = updated.replace(
    staticImportRe,
    (full, prefix, quote, specifier, quoteAgain) => {
      const suffix = resolveSuffix(filePath, specifier);
      if (!suffix) {
        return full;
      }
      changed = true;
      return `${prefix}${quote}${specifier}${suffix}${quoteAgain}`;
    }
  );

  updated = updated.replace(
    dynamicImportRe,
    (full, prefix, quote, specifier, quoteAgain, suffixPart) => {
      const suffix = resolveSuffix(filePath, specifier);
      if (!suffix) {
        return full;
      }
      changed = true;
      return `${prefix}${quote}${specifier}${suffix}${quoteAgain}${suffixPart}`;
    }
  );

  return { updated, changed };
}

function walk(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (entry.isFile() && JS_FILE_RE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function run() {
  if (!fs.existsSync(DIST_ROOT)) {
    throw new Error(`dist not found at ${DIST_ROOT}`);
  }

  const files = walk(DIST_ROOT);
  let touched = 0;

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const { updated, changed } = rewriteSource(filePath, source);
    if (!changed) {
      continue;
    }
    fs.writeFileSync(filePath, updated, 'utf8');
    touched += 1;
  }

  console.log(
    `Rewrote extensionless relative imports in workflow-worker dist files: ${touched}`
  );
}

try {
  run();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
}
