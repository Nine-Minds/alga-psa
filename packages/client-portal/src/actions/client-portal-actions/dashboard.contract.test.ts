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
});
