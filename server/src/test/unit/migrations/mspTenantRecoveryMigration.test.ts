import { describe, expect, it, vi } from 'vitest';
import { ESLint } from 'eslint';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));

describe('MSP tenant recovery migration', () => {
  it('passes migration validation at the original CI run time', async () => {
    const directory = path.join(root, 'server/migrations');
    const migrations = (await readdir(directory)).filter((name) =>
      name.endsWith('_add_msp_tenant_recovery_email_template.cjs'),
    );
    expect(migrations).toHaveLength(1);

    // Reproduce the clock that rejected the future-dated migration, so this
    // regression remains detectable after that timestamp has passed.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T02:00:00Z'));
    try {
      const eslint = new ESLint({ cwd: root });
      const results = await eslint.lintFiles(migrations.map((name) => path.join(directory, name)));
      expect(results.flatMap((result) => result.messages.filter((message) => message.severity === 2)))
        .toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
