import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'cleanupInboundEmailQuarantineJob.ts'), 'utf8');

describe('cleanup inbound email quarantine job', () => {
  it('prunes only DISMISSED rows past the 90-day window through an explicit unscoped maintenance boundary', () => {
    expect(source).toContain('QUARANTINE_DISMISSED_RETENTION_DAYS = 90');
    expect(source).toContain(".where('status', 'dismissed')");
    expect(source).toContain(".unscoped('inbound_email_quarantine', QUARANTINE_CLEANUP_REASON)");
    expect(source).toContain(".unscoped('inbound_email_quarantine as q', QUARANTINE_CLEANUP_REASON)");
    expect(source).toContain(".where('q.tenant', knex.ref('doomed.tenant'))");
    expect(source).not.toContain('DELETE FROM inbound_email_quarantine');
  });
});
