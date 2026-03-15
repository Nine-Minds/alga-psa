import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ContractDetail.tsx', import.meta.url),
  'utf8'
);

describe('ContractDetail assignment renewal settings wiring', () => {
  it('renders renewal settings controls while editing assignments', () => {
    expect(source).toContain('Use tenant renewal defaults');
    expect(source).toContain('assignment-renewal-mode-');
    expect(source).toContain('assignment-notice-period-');
    expect(source).toContain('assignment-renewal-term-');
    expect(source).toContain('assignment-renewal-ticket-board-');
    expect(source).toContain('assignment-renewal-ticket-status-');
  });

  it('persists edited renewal fields on save', () => {
    expect(source).toContain('updatePayload.use_tenant_renewal_defaults');
    expect(source).toContain('updatePayload.renewal_mode');
    expect(source).toContain('updatePayload.notice_period_days');
    expect(source).toContain('updatePayload.renewal_term_months');
    expect(source).toContain('updatePayload.renewal_ticket_board_id');
    expect(source).toContain('updatePayload.renewal_ticket_status_id');
  });
});
