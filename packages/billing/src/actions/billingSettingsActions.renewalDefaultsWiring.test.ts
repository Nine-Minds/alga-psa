import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./billingSettingsActions.ts', import.meta.url), 'utf8');

describe('billingSettingsActions renewal default wiring', () => {
  it('extends BillingSettings model with renewal default fields', () => {
    expect(source).toContain('defaultRenewalMode?: RenewalMode;');
    expect(source).toContain('defaultNoticePeriodDays?: number;');
    expect(source).toContain('renewalDueDateActionPolicy?: RenewalDueDateActionPolicy;');
    expect(source).toContain('renewalTicketBoardId?: string;');
    expect(source).toContain('renewalTicketStatusId?: string;');
    expect(source).toContain('renewalTicketPriority?: string;');
    expect(source).toContain('renewalTicketAssigneeId?: string;');
  });

  it('returns renewal defaults from getDefaultBillingSettings with fallbacks', () => {
    expect(source).toContain('defaultRenewalMode: DEFAULT_RENEWAL_MODE');
    expect(source).toContain('defaultNoticePeriodDays: DEFAULT_NOTICE_PERIOD_DAYS');
    expect(source).toContain(
      'renewalDueDateActionPolicy: DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY'
    );
    expect(source).toContain('renewalTicketBoardId: settings.renewal_ticket_board_id ?? undefined');
    expect(source).toContain('renewalTicketStatusId: settings.renewal_ticket_status_id ?? undefined');
    expect(source).toContain('renewalTicketPriority: settings.renewal_ticket_priority ?? undefined');
    expect(source).toContain(
      'renewalTicketAssigneeId: settings.renewal_ticket_assignee_id ?? undefined'
    );
  });

  it('persists renewal default fields in updateDefaultBillingSettings with schema guards', () => {
    expect(source).toContain("trx.schema.hasColumn('default_billing_settings', 'default_renewal_mode')");
    expect(source).toContain(
      "trx.schema.hasColumn('default_billing_settings', 'default_notice_period_days')"
    );
    expect(source).toContain(
      "trx.schema.hasColumn('default_billing_settings', 'renewal_due_date_action_policy')"
    );
    expect(source).toContain("trx.schema.hasColumn('default_billing_settings', 'renewal_ticket_board_id')");
    expect(source).toContain("trx.schema.hasColumn('default_billing_settings', 'renewal_ticket_status_id')");
    expect(source).toContain("trx.schema.hasColumn('default_billing_settings', 'renewal_ticket_priority')");
    expect(source).toContain("trx.schema.hasColumn('default_billing_settings', 'renewal_ticket_assignee_id')");
    expect(source).toContain('renewalUpdates.default_renewal_mode');
    expect(source).toContain('renewalUpdates.default_notice_period_days');
    expect(source).toContain('renewalUpdates.renewal_due_date_action_policy');
    expect(source).toContain('renewalUpdates.renewal_ticket_board_id');
    expect(source).toContain('renewalUpdates.renewal_ticket_status_id');
    expect(source).toContain('renewalUpdates.renewal_ticket_priority');
    expect(source).toContain('renewalUpdates.renewal_ticket_assignee_id');
  });
});
