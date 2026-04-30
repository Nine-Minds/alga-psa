import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './dashboard.ts'),
  'utf8',
);

describe('dashboard action contract', () => {
  it('hides draft invoices from recent activity', () => {
    // Drafts (finalized_at IS NULL) must not appear in the activity feed —
    // they aren't visible in /billing/invoices either.
    expect(source).toContain(".whereNotNull('inv.finalized_at')");
  });

  it('returns a total service-requests count for the dashboard (not status-filtered)', () => {
    // Pending is a transient state on the default provider, so a pending-only
    // count would always read 0. Counting all submissions is the meaningful number.
    expect(source).toContain('serviceRequests:');
    expect(source).toContain("trx('service_request_submissions')");
    expect(source).not.toMatch(/'execution_status':\s*['"]pending['"]/);
  });

  it('extracts plain text from BlockNote JSON for ticket activity descriptions', () => {
    expect(source).toContain('extractPlainTextFromBlockNote');
    expect(source).toContain('summarizeForActivity');
  });

  it('emits all seven activity types', () => {
    // Original three plus quote/project/service_request/appointment.
    expect(source).toMatch(/type:\s*['"]ticket['"]/);
    expect(source).toMatch(/type:\s*['"]invoice['"]/);
    expect(source).toMatch(/type:\s*['"]asset['"]/);
    expect(source).toMatch(/type:\s*['"]quote['"]/);
    expect(source).toMatch(/type:\s*['"]project['"]/);
    expect(source).toMatch(/type:\s*['"]service_request['"]/);
    expect(source).toMatch(/type:\s*['"]appointment['"]/);
  });

  it('only surfaces client-meaningful quote states', () => {
    expect(source).toMatch(/whereIn\('status',\s*\[\s*'sent',\s*'accepted',\s*'rejected',\s*'expired'\s*\]\)/);
  });
});
