import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractSubtree } from 'server/src/lib/extensions/bundles';

export interface CacheIndexItem { key: string; bytes?: number; at: number }
export interface CacheIndex { items: CacheIndexItem[]; maxBytes: number }

function root(): string {
  const base = process.env.EXT_CACHE_ROOT || '.alga-ext-cache';
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return base;
}

function indexPath(): string { return join(root(), '_index.json'); }

function readIndex(): CacheIndex {
  try {
    const txt = readFileSync(indexPath(), 'utf8');
    return JSON.parse(txt);
  } catch {
    return { items: [], maxBytes: 2 * 1024 * 1024 * 1024 };
  }
}

function writeIndex(idx: CacheIndex) {
  writeFileSync(indexPath(), JSON.stringify(idx));
}

function maybeEvict(maxBytes: number) {
  const idx = readIndex();
  // naive eviction: remove oldest cached UI dirs if exceeding maxBytes by counting file sizes
  function dirSize(p: string): number {
    try {
      const s = statSync(p);
      if (!s.isDirectory()) return s.size;
      let total = 0;
      for (const entry of readdirSync(p, { withFileTypes: true })) {
        const child = join(p, entry.name);
        total += dirSize(child);
      }
      return total;
    } catch { return 0; }
  }
  let total = 0;
  const items = idx.items.map(it => ({ ...it, bytes: dirSize(it.key) })).sort((a,b) => a.at - b.at);
  for (const it of items) total += (it.bytes || 0);
  while (total > maxBytes && items.length) {
    const victim = items.shift()!;
    try { rmSync(victim.key, { recursive: true, force: true }); } catch {}
    total -= victim.bytes || 0;
    idx.items = idx.items.filter(i => i.key !== victim.key);
  }
  writeIndex(idx);
}

export async function ensureUiCached(contentHash: string): Promise<string> {
  const dir = join(root(), contentHash.replace('sha256:', ''), 'ui');
  if (!existsSync(dir)) {
    // simple lock to avoid double-extract
    const lock = dir + '.lock';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(lock, String(Date.now()));
      await extractSubtree(contentHash, 'ui', dir);
    } finally {
      try { rmSync(lock, { force: true }); } catch {}
    }
    const idx = readIndex();
    idx.items.push({ key: dir, at: Date.now() });
    writeIndex(idx);
    maybeEvict(idx.maxBytes);
  }
  return dir;
}

