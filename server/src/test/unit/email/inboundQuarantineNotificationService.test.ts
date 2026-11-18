import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions', () => ({
  createNotificationFromTemplateInternal: vi.fn(),
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn() }));

import { QUARANTINE_REASONS } from '@alga-psa/shared/services/email/inboundQuarantine';
import {
  INBOUND_QUARANTINE_QUEUE_PATH,
  buildQuarantineAnnouncement,
  describeQuarantineReason,
} from '../../../services/email/inboundQuarantineNotificationService';

const params = {
  tenant: 't', quarantineId: 'q', providerId: 'p', mailbox: 'support@msp.example',
  sender: 'someone@customer.example', subject: 'Re: printer', reason: 'unauthorized_thread_header_sender' as const,
  matchedBy: 'thread_headers' as const, ticketId: 'x', ticketNumber: 'TIC-1042', quarantinedAt: new Date().toISOString(),
};

describe('quarantine notification content', () => {
  it('names the mailbox, sender, subject, matched ticket and a plain-language reason', () => {
    const text = buildQuarantineAnnouncement(params);
    expect(text).toContain('support@msp.example');
    expect(text).toContain('someone@customer.example');
    expect(text).toContain('Re: printer');
    expect(text).toContain('TIC-1042');
    expect(text).toContain(describeQuarantineReason('unauthorized_thread_header_sender'));
    expect(text).not.toContain('unauthorized_thread_header_sender'); // no raw enum string
  });

  it('omits the ticket sentence when there is no matched ticket', () => {
    expect(buildQuarantineAnnouncement({ ...params, ticketNumber: null, ticketId: null })).not.toContain('reply to ticket');
  });

  it('every closed reason has its own plain-language description', () => {
    const generic = describeQuarantineReason('not_a_reason');
    for (const reason of QUARANTINE_REASONS) {
      expect(describeQuarantineReason(reason)).not.toBe(generic);
    }
  });

  it('links to the queue page', () => {
    expect(INBOUND_QUARANTINE_QUEUE_PATH).toBe('/msp/settings/email/quarantine');
  });
});
