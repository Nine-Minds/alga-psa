import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Alga convention: every interactive element in a settings panel carries a
 * stable kebab-case id, prefixed per panel. The only ids allowed without the
 * `datto-rmm-` prefix are the ones the shared mapping components define for
 * all RMM providers.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../../../../..');
const FILE = 'ee/server/src/components/settings/integrations/DattoRmmIntegrationSettings.tsx';
const text = fs.readFileSync(path.resolve(REPO_ROOT, FILE), 'utf8');

const SHARED_ID_PREFIXES = ['rmm-org-people-mode-'];

describe('Datto RMM settings panel ids', () => {
  const ids = [...text.matchAll(/\bid=(?:"([^"]+)"|\{`([^`]+)`\})/g)].map((m) => m[1] ?? m[2]);

  it('finds the panel ids', () => {
    expect(ids.length).toBeGreaterThan(30);
  });

  it('prefixes every id with datto-rmm- (or a shared RMM prefix)', () => {
    const offenders = ids.filter(
      (id) => !id.startsWith('datto-rmm-') && !SHARED_ID_PREFIXES.some((p) => id.startsWith(p))
    );
    expect(offenders).toEqual([]);
  });

  it('uses kebab-case ids', () => {
    const offenders = ids
      .map((id) => id.replace(/\$\{[^}]+\}/g, 'x'))
      .filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id));
    expect(offenders).toEqual([]);
  });

  it('has no duplicate static ids', () => {
    // The reboot component is a select or a UID input, never both at once.
    const staticIds = ids.filter((id) => !id.includes('${') && id !== 'datto-rmm-reboot-component');
    expect(new Set(staticIds).size).toBe(staticIds.length);
  });

  it('routes every user-facing string key through the integrations.rmm.datto namespace', () => {
    const keys = [...text.matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]);
    const foreign = keys.filter(
      (k) => !k.startsWith('integrations.rmm.datto.') && !k.startsWith('integrations.rmm.') && !k.startsWith('common:')
    );
    expect(foreign).toEqual([]);
  });
});
