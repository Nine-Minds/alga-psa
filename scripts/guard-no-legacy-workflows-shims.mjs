import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const legacyDirs = [
  'packages/workflows/src/ee',
  'packages/workflows/src/oss',
];

const legacyFiles = [
  'packages/workflows/src/entry.ts',
  'packages/workflows/src/entry.tsx',
];

const bannedNeedles = [
  'packages/workflows/src/ee/',
  'packages/workflows/src/oss/',
  'packages/workflows/src/entry',
];

const scanRoots = [
  'server',
  'ee/server',
  'packages',
].map((p) => path.join(repoRoot, p));

const ignoredDirNames = new Set([
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'tmp',
]);

const allowedExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
]);

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function directoryHasAnyFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile()) return true;
    if (entry.isDirectory()) {
      if (await directoryHasAnyFiles(fullPath)) return true;
    }
  }
  return false;
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirNames.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (allowedExtensions.has(ext)) files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  for (const rel of legacyFiles) {
    const abs = path.join(repoRoot, rel);
    if (await pathExists(abs)) {
      console.error('[workflows-shim-guard] Found legacy workflows shim artifact:', abs);
      process.exit(1);
    }
  }

  for (const rel of legacyDirs) {
    const abs = path.join(repoRoot, rel);
    if (await pathExists(abs)) {
      try {
        if (await directoryHasAnyFiles(abs)) {
          console.error('[workflows-shim-guard] Found legacy workflows shim directory with files:', abs);
          process.exit(1);
        }
      } catch {
        // If we can't read it, be conservative.
        console.error('[workflows-shim-guard] Unable to validate legacy workflows shim directory:', abs);
        process.exit(1);
      }
    }
  }

  const hits = [];
  for (const root of scanRoots) {
    if (!(await pathExists(root))) continue;
    const files = await walk(root);
    for (const filePath of files) {
      let contents;
      try {
        contents = await fs.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      for (const needle of bannedNeedles) {
        if (contents.includes(needle)) {
          hits.push({ filePath, needle });
        }
      }
    }
  }

  if (hits.length > 0) {
    console.error('[workflows-shim-guard] Found references to legacy workflows shims:');
    for (const hit of hits.slice(0, 20)) {
      console.error(`- ${hit.filePath} (needle: ${JSON.stringify(hit.needle)})`);
    }
    if (hits.length > 20) {
      console.error(`...and ${hits.length - 20} more`);
    }
    process.exit(1);
  }

  console.log('[workflows-shim-guard] OK: no legacy workflows shims present or referenced.');
}

await main();
