import { mkdirSync } from 'node:fs';

export function ensureDir(p: string) {
  try { mkdirSync(p, { recursive: true }); } catch {}
}

