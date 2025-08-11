/**
 * Pack an extension bundle directory into bundle.tar.zst and compute sha256.
 *
 * Usage:
 *   node ee/tools/ext-bundle/pack.ts <inputDir> <outputBundlePath>
 *
 * Behavior:
 *   - Validates inputDir exists and is a directory.
 *   - Produces a tar archive of inputDir and compresses with zstd (external tools).
 *     TODO: fallback to JS tar/zstd libs if system tools are unavailable.
 *   - Computes sha256 of the resulting .tar.zst and writes a sidecar file:
 *       - If output is bundle.tar.zst → writes bundle.sha256 alongside it.
 *       - Otherwise writes <basename>.sha256 alongside the output path.
 *   - Prints:
 *       sha256:<hash>  <outputBundlePath>
 *   - Exits non-zero on any error.
 *
 * Requirements:
 *   - Node 18+ (for fs/promises, crypto, etc.)
 *   - System tools: tar, zstd (recommended)
 */

import { statSync, accessSync, constants, createReadStream, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function die(msg: string, code = 1): never {
  console.error(`[pack] ${msg}`);
  process.exit(code);
}

function fileSha256Hex(filePath: string): string {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  return new Promise<string>((resolveHash, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  }) as unknown as string; // We'll wrap sync by reading fully below if needed (but prefer streaming).
}

// Simple blocking sha256 (reads file fully) for predictability in a short script
function fileSha256HexSync(filePath: string): string {
  const h = createHash('sha256');
  const stream = createReadStream(filePath);
  return new Promise<string>((resolveHash, reject) => {
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(h.digest('hex')));
  }) as unknown as string;
}

// Since top-level await isn't used, provide a blocking read helper:
function sha256Sync(filePath: string): string {
  // Read the entire file and compute sha256 (ESM-friendly, no require)
  const data = readFileSync(filePath);
  const h = createHash('sha256');
  h.update(data);
  return h.digest('hex');
}

function ensureDir(pathStr: string) {
  try {
    mkdirSync(pathStr, { recursive: true });
  } catch (e) {
    // ignore if exists
  }
}

function which(bin: string): boolean {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' });
  return result.status === 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    die('Usage: node ee/tools/ext-bundle/pack.ts <inputDir> <outputBundlePath(.tar.zst)>');
  }

  const inputDir = resolve(args[0]);
  const outputPath = resolve(args[1]);

  // Validate input
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(inputDir);
  } catch {
    die(`Input directory not found: ${inputDir}`);
  }
  if (!st.isDirectory()) {
    die(`Input is not a directory: ${inputDir}`);
  }

  // Ensure parent dir for output exists
  ensureDir(dirname(outputPath));

  // Validate tools
  const hasTar = which('tar');
  const hasZstd = which('zstd');

  if (!hasTar || !hasZstd) {
    console.warn('[pack] WARNING: tar or zstd not found on PATH.');
    console.warn('[pack] TODO: Implement JS fallback for packing and compression.');
    die('Missing required system tools: tar and zstd');
  }

  // Create a tar archive and compress with zstd.
  // We want the archive to contain the directory contents (not the parent dir name).
  // Use: tar -C inputDir -cf - . | zstd -19 -T0 -o outputPath
  const tarCmd = `tar -C "${inputDir}" -cf - . | zstd -19 -T0 -o "${outputPath}"`;
  const shell = process.env.SHELL || '/bin/sh';
  const proc = spawnSync(shell, ['-lc', tarCmd], { stdio: 'inherit' });
  if (proc.status !== 0) {
    die(`Packing failed with status ${proc.status}`);
  }

  // Compute sha256 of the resulting file
  let hashHex: string;
  try {
    hashHex = sha256Sync(outputPath);
  } catch (e) {
    die(`Failed to compute sha256: ${(e as Error).message}`);
  }

  // Sidecar naming
  const base = basename(outputPath);
  const sidecarName = base === 'bundle.tar.zst' ? 'bundle.sha256' : `${base}.sha256`;
  const sidecarPath = join(dirname(outputPath), sidecarName);

  try {
    writeFileSync(sidecarPath, `${hashHex}\n`, { encoding: 'utf8', flag: 'w' });
  } catch (e) {
    die(`Failed to write sidecar sha256 file: ${(e as Error).message}`);
  }

  // Output concise result
  console.log(`sha256:${hashHex}  ${outputPath}`);
  console.log(`[pack] wrote sidecar: ${sidecarPath}`);
  process.exit(0);
}

try {
  main();
} catch (e) {
  die((e as Error).message);
}