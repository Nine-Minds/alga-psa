import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('Algadesk inbound email channel configuration contract', () => {
  it('T022: email channel UI/actions expose inbound mailbox provider configuration fields', () => {
    const configPath = path.resolve(__dirname, '../../../../../packages/integrations/src/components/email/EmailProviderConfiguration.tsx');
    const providerActionsPath = path.resolve(__dirname, '../../../../../packages/integrations/src/actions/email-actions/emailProviderActions.ts');

    const configSource = fs.readFileSync(configPath, 'utf8');
    const actionsSource = fs.readFileSync(providerActionsPath, 'utf8');

    expect(configSource).toContain('Email Provider Configuration');
    expect(configSource).toContain('GmailProviderForm');
    expect(configSource).toContain('MicrosoftProviderForm');
    expect(configSource).toContain('ImapProviderForm');
    expect(configSource).toContain('Add Email Provider');

    expect(actionsSource).toContain('provider_type: data.providerType');
    expect(actionsSource).toContain('mailbox: data.mailbox');
    expect(actionsSource).toContain('is_active: data.isActive');
    expect(actionsSource).toContain('inbound_ticket_defaults_id: data.inboundTicketDefaultsId || null');
  });
});
