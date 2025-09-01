import { mkdirSync, cpSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function ensureDir(p: string) {
  try { mkdirSync(p, { recursive: true }); } catch {}
}

export function copyRecursive(src: string, dest: string) {
  cpSync(src, dest, { recursive: true });
}

export function listDir(dir: string): string[] {
  return readdirSync(dir);
}

export function exists(path: string) {
  try { return existsSync(path); } catch { return false; }
}

export function readText(path: string) {
  return readFileSync(path, 'utf8');
}

export function writeText(path: string, text: string) {
  ensureDir(dirname(path));
  writeFileSync(path, text, { encoding: 'utf8' });
}

