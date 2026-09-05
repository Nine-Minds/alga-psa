import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalCallRecordSchema } from './index';

describe('canonicalCallRecordSchema', () => {
  const valid = {
    provider: 'teams-phone',
    providerCallId: 'cdr-1',
    direction: 'inbound' as const,
    callerNumber: { raw: '+15551234567', e164: '+15551234567' },
    calleeNumber: { raw: '+15559990000', e164: '+15559990000' },
    startedAt: '2026-08-22T10:00:00.000Z',
    endedAt: '2026-08-22T10:04:00.000Z',
    durationSeconds: 240,
    modality: 'audio' as const,
    raw: { id: 'cdr-1' },
  };

  it('T014: accepts a complete canonical payload', () => {
    expect(canonicalCallRecordSchema.parse(valid)).toMatchObject({ providerCallId: 'cdr-1' });
  });

  it('T014: accepts the minimum payload', () => {
    expect(
      canonicalCallRecordSchema.safeParse({ provider: 'teams-phone', providerCallId: 'x', direction: 'missed' }).success,
    ).toBe(true);
  });

  it('T014: rejects a missing provider_call_id', () => {
    const { providerCallId: _omitted, ...withoutId } = valid;
    expect(canonicalCallRecordSchema.safeParse(withoutId).success).toBe(false);
    expect(canonicalCallRecordSchema.safeParse({ ...valid, providerCallId: '' }).success).toBe(false);
  });

  it('T014: rejects an unknown direction', () => {
    expect(canonicalCallRecordSchema.safeParse({ ...valid, direction: 'sideways' }).success).toBe(false);
  });
});

describe('telephony core layering', () => {
  it('T015: the core imports no provider adapter', () => {
    const srcRoot = path.resolve(__dirname, '..');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
        const source = fs.readFileSync(full, 'utf8');
        if (/from ['"]@alga-psa\/ee-microsoft-teams/.test(source) || /microsoft-teams/.test(source)) {
          offenders.push(path.relative(srcRoot, full));
        }
      }
    };
    walk(srcRoot);

    expect(offenders).toEqual([]);
  });
});
