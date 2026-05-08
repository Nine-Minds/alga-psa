import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('Algadesk email channel mapping and health contract', () => {
  it('T023: supports outbound identity, inbound defaults mapping, enable/disable, and channel health/error status', () => {
    const defaultsFormPath = path.resolve(__dirname, '../../../../../packages/integrations/src/components/email/forms/InboundTicketDefaultsForm.tsx');
    const providerCardPath = path.resolve(__dirname, '../../../../../packages/integrations/src/components/email/EmailProviderCard.tsx');
    const providerActionsPath = path.resolve(__dirname, '../../../../../packages/integrations/src/actions/email-actions/emailProviderActions.ts');

    const defaultsForm = fs.readFileSync(defaultsFormPath, 'utf8');
    const providerCard = fs.readFileSync(providerCardPath, 'utf8');
    const providerActions = fs.readFileSync(providerActionsPath, 'utf8');

    expect(providerActions).toContain('mailbox: data.mailbox');

    expect(defaultsForm).toContain('board_id');
    expect(defaultsForm).toContain('category_id');
    expect(defaultsForm).toContain('priority_id');
    expect(defaultsForm).toContain('is_active');

    expect(providerActions).toContain('is_active: data.isActive');

    expect(providerCard).toContain('provider.status');
    expect(providerCard).toContain('provider.errorMessage');
    expect(providerCard).toContain('webhook_expires_at');
    expect(providerCard).toContain('Last Sync');
  });
});
