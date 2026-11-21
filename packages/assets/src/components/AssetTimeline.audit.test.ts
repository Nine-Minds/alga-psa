/**
 * The timeline's wording for a site audit entry.
 *
 * `complete` writes one `asset_history` row per audited asset with
 * `{audit_id, result, location_id, method}`. With no branch for it the generic
 * path rendered the title "Audit" and the detail line "Audit id, Result,
 * Location id" — the payload's key names, which answer nothing.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../actions/assetActions', () => ({
  getAssetHistory: vi.fn(),
  getAssetLinkedTickets: vi.fn(),
  getAssetMaintenanceReport: vi.fn(),
}));
vi.mock('../actions/assetActionErrors', () => ({
  unwrapAssetActionResult: (value: unknown) => value,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const { describeAssetHistoryEntry } = await import('./AssetTimeline');

const t = (key: string, options?: Record<string, unknown>) => {
  let result = String(options?.defaultValue ?? key);
  for (const [name, value] of Object.entries(options ?? {})) {
    if (name !== 'defaultValue') result = result.replace(`{{${name}}}`, String(value));
  }
  return result;
};

const auditEntry = (changes: Record<string, unknown>) => ({ change_type: 'audit', changes });

describe('describeAssetHistoryEntry — site audits', () => {
  it('words a present result as a found device, in a good tone', () => {
    const described = describeAssetHistoryEntry(
      auditEntry({ audit_id: 'audit-1', result: 'present', method: 'scan', location_id: 'loc-1' }),
      t,
    );

    expect(described?.title).toBe('Audit: present');
    expect(described?.tone).toBe('good');
  });

  it('words a missing result as a bad one', () => {
    const described = describeAssetHistoryEntry(
      auditEntry({ audit_id: 'audit-1', result: 'missing', method: null, location_id: 'loc-1' }),
      t,
    );

    expect(described?.title).toBe('Audit: missing');
    expect(described?.tone).toBe('bad');
  });

  it('puts how the device was marked in the detail line, not the payload keys', () => {
    const described = describeAssetHistoryEntry(
      auditEntry({ audit_id: 'audit-1', result: 'present', method: 'manual' }),
      t,
    );

    expect(described?.detail).toBe('Marked by manual');
    expect(described?.detail).not.toMatch(/Audit id|Location id/);
  });

  it('omits the detail line when no method was recorded', () => {
    const described = describeAssetHistoryEntry(auditEntry({ audit_id: 'audit-1', result: 'missing' }), t);

    expect(described?.detail).toBeUndefined();
  });

  it('links the entry to the run it came from', () => {
    const described = describeAssetHistoryEntry(
      auditEntry({ audit_id: 'audit-7', result: 'present', method: 'scan' }),
      t,
    );

    expect(described?.href).toBe('/msp/assets/audits/audit-7');
  });

  it('still reads as an audit when the payload carries no audit id', () => {
    const described = describeAssetHistoryEntry(auditEntry({ result: 'present' }), t);

    expect(described?.title).toBe('Audit: present');
    expect(described?.href).toBeUndefined();
  });

  it('falls back to a plain Audit title for an unrecognised result', () => {
    const described = describeAssetHistoryEntry(auditEntry({ audit_id: 'audit-1', result: 'weird' }), t);

    expect(described?.title).toBe('Audit');
    expect(described?.tone).toBe('neutral');
  });
});
