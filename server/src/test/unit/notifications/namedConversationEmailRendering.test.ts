import { beforeEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ prepare: vi.fn(), send: vi.fn(), tenant: vi.fn() }));
vi.mock('@alga-psa/email', () => ({ TenantEmailService: { getInstance: (tenant: string) => {
  runtime.tenant(tenant); return { prepareReviewedEmail: runtime.prepare, sendEmail: runtime.send };
} } }));
vi.mock('@alga-psa/co-managed', () => ({ prepareNamedConversationEmail: vi.fn(), confirmNamedConversationEmail: vi.fn(), deliverNamedConversationEmail: vi.fn() }));
vi.mock('../../../../../packages/tickets/src/lib/postNamedTicketConversation', () => ({ applyNamedTicketConversationPost: vi.fn() }));
import { namedConversationEmailTransport } from '../../../../../packages/tickets/src/lib/namedConversationEmail';
import { previewReviewedEmail } from '../../../../../packages/email/src/reviewedEmail';
beforeEach(() => {
  vi.clearAllMocks(); runtime.prepare.mockImplementation(async payload => previewReviewedEmail(payload, { providerId: 'smtp', providerType: 'smtp' }, 'a'.repeat(64)));
  runtime.send.mockResolvedValue({ success: true, metadata: { deliveryStatus: 'delivered' } });
});
it('renders only the selected rich message and sends through the reviewed mailbox owner with explicit conversation headers', async () => {
  const mailbox = { tenant: 'mailbox-owner', id: 'mailbox-id', email: 'support@example.test', name: 'Support' };
  const prepared = await namedConversationEmailTransport.prepare({ mailbox,
    content: { document: [{ type: 'paragraph', content: [{ type: 'text', text: 'Selected diagnosis', styles: { bold: true } }] }] },
    envelope: { subject: 'Vendor case', to: [{ email: 'vendor@example.test' }], cc: [] },
    headers: { 'Message-ID': '<vendor-operation@example.test>', 'In-Reply-To': '<vendor-prior@example.test>' }, replyToken: `tc1:${'a'.repeat(43)}` });
  expect(prepared.payload.html).toMatch(/<(strong|b)>Selected diagnosis<\/(strong|b)>/);
  expect(prepared.payload.text).toContain('Selected diagnosis');
  expect(prepared.payload.text).toContain('[ALGA-REPLY-TOKEN tc1:');
  expect(prepared.review).toMatchObject({ from: { email: mailbox.email }, to: [{ email: 'vendor@example.test' }], files: [] });
  expect(runtime.send).not.toHaveBeenCalled();
  await namedConversationEmailTransport.send(prepared.payload, prepared.review, mailbox);
  expect(runtime.send).toHaveBeenCalledWith(expect.objectContaining({ tenantId: mailbox.tenant, retryPolicy: 'caller', threading: 'conversation', reviewed: prepared.review,
    headers: prepared.payload.headers, html: prepared.payload.html, text: prepared.payload.text }));
  expect(runtime.tenant.mock.calls.every(([tenant]) => tenant === mailbox.tenant)).toBe(true);
});
