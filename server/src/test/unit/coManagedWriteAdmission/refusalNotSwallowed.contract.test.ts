/**
 * A7: a refusal must reach the caller. On the seven A4 surface files, every `catch` that
 * sits around a write must rethrow, or pass the caught error on (log, map, return it).
 * A catch that binds nothing, or binds an error and never reads it, swallows refusals.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../../..');
const SURFACE_FILES = [
  'server/src/lib/api/services/TicketService.ts',
  'packages/tickets/src/models/comment.ts',
  'packages/projects/src/models/project.ts',
  'packages/projects/src/models/projectTask.ts',
  'packages/assets/src/actions/assetActions.ts',
  'ee/server/src/lib/actions/credentials/credentialActions.ts',
  'packages/client-portal/src/actions/client-portal-actions/client-tickets.ts',
];
const EXEMPT = /write-admission:\s*exempt\s*[—-]\s*\S+/;

export function findSwallowingCatches(source: string): Array<{ line: number; reason: string }> {
  const out: Array<{ line: number; reason: string }> = [];
  const re = /\bcatch\s*(?:\(\s*([A-Za-z_$][\w$]*)(?:\s*:\s*\w+)?\s*\))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) { end = i; break; }
    }
    const body = source.slice(open + 1, end);
    const line = source.slice(0, m.index).split('\n').length;
    const before = source.slice(Math.max(0, m.index - 200), m.index + m[0].length);
    if (EXEMPT.test(before) || EXEMPT.test(body)) continue;
    const name = m[1];
    if (/\bthrow\b/.test(body)) continue;
    if (!name) out.push({ line, reason: 'catch binds no error' });
    else if (!new RegExp(`\\b${name.replace('$', '\\$')}\\b`).test(body)) out.push({ line, reason: `catch (${name}) never reads the error` });
  }
  return out;
}

describe('refusals are not swallowed (A7)', () => {
  it('the scanner flags a swallowing catch and accepts a rethrow or a mapped error', () => {
    expect(findSwallowingCatches('try { x() } catch { }')).toHaveLength(1);
    expect(findSwallowingCatches('try { x() } catch (e) { return null; }')).toHaveLength(1);
    expect(findSwallowingCatches('try { x() } catch (e) { throw e; }')).toHaveLength(0);
    expect(findSwallowingCatches('try { x() } catch (e) { return map(e); }')).toHaveLength(0);
  });

  it.each(SURFACE_FILES)('%s has no catch that drops the error', (file) => {
    const found = findSwallowingCatches(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    expect(found.map((f) => `${file}:${f.line} ${f.reason}`)).toEqual([]);
  });
});
