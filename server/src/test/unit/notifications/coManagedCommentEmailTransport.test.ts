import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const runtime = vi.hoisted(() => ({ send: vi.fn(), locale: vi.fn(), tenant: vi.fn(), routing: vi.fn(), mailbox: vi.fn() }));
vi.mock('@alga-psa/email', () => ({ TenantEmailService: { getInstance: (tenant: string) => { runtime.tenant(tenant); return { sendEmail: runtime.send }; } },
  StaticTemplateProcessor: class { constructor(private subject: string, private html: string, private text: string) {} async process() { return { subject: this.subject, html: this.html, text: this.text }; } } }));
vi.mock('@alga-psa/jobs/handlers/coManagedRequesterEmailRouting', () => ({ resolveCoManagedRequesterEmailRouting: runtime.routing, resolveCoManagedTicketEmailMailbox: runtime.mailbox }));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({ resolveEmailLocale: runtime.locale }));
import { sendCoManagedCommentEmail } from '@alga-psa/jobs/handlers/coManagedCommentEmailTransport';
import type { CoManagedEmailDelivery } from '@alga-psa/co-managed';
const delivery = (): CoManagedEmailDelivery => ({ tenant: randomUUID(), recipientUserId: randomUUID(), email: 'authorized@example.test', messageId: '<stable@notifications.alga.invalid>', subtypeId: 3,
  message: { resource: { tenant: randomUUID(), relationshipId: randomUUID(), kind: 'ticket', id: randomUUID() }, commentId: randomUUID(), threadId: randomUUID(), audience: 'shared_it',
    ticketNumber: 'T-1', ticketTitle: '<img src=x onerror=alert(1)>', note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: '<script>private()</script> & current text', styles: {} }], children: [] }]),
    author: { tenant: randomUUID(), id: randomUUID(), kind: 'user', referenceId: null, displayName: 'A < B', organizationName: 'Customer' } } });
beforeEach(() => { runtime.send.mockReset().mockResolvedValue({ success: true }); runtime.locale.mockReset().mockResolvedValue('en'); runtime.tenant.mockClear(); runtime.mailbox.mockReset().mockResolvedValue({ from: { email: 'support@example.test' }, replyTo: { email: 'intake@example.test' } }); });
it('renders only supplied authorized fields, escapes content, links the qualified source and retains caller-owned retry and stable identity', async () => {
  const item = delivery(); expect(await sendCoManagedCommentEmail(item)).toEqual({ status: 'delivered' });
  expect(runtime.tenant).toHaveBeenCalledWith(item.tenant);
  const params = runtime.send.mock.calls[0][0], content = await params.templateProcessor.process();
  expect(params).toMatchObject({ tenantId: item.tenant, to: item.email, userId: item.recipientUserId, retryPolicy: 'caller', headers: { 'Message-ID': item.messageId } });
  expect(params).not.toHaveProperty('replyContext'); expect(params).not.toHaveProperty('entityId');
  expect(content.html).toContain(`/${item.message.resource.tenant}/${item.message.resource.relationshipId}/${item.message.resource.id}`);
  expect(content.html).toContain('&lt;script&gt;'); expect(content.html).not.toContain('<script>'); expect(content.html).not.toContain('<img src=x');
  expect(content.text).toContain('<script>private()</script> & current text'); expect(content.html).toContain('A &lt; B');
});
it.each(['en', 'en-AU', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt', 'xx', 'yy'])('supports the recipient locale %s without changing resource identity', async locale => {
  runtime.locale.mockResolvedValue(locale); const item = delivery(); await sendCoManagedCommentEmail(item);
  const content = await runtime.send.mock.calls[0][0].templateProcessor.process();
  expect(content.subject).toBeTruthy(); expect(content.text).toContain(item.message.resource.id);
});
it.each([
  [{ success: false, metadata: { retryable: true, retryAfterMs: 70000 } }, { status: 'failed', retryable: true, errorCode: 'email_provider_failed', retryAfterMs: 70000 }],
  [{ success: false, metadata: { retryable: false } }, { status: 'failed', retryable: false, errorCode: 'email_provider_failed' }],
  [{ success: true, queued: true }, { status: 'failed', retryable: false, errorCode: 'unexpected_generic_email_queue' }],
  [{ success: false, error: 'Email service is disabled or not configured' }, { status: 'failed', retryable: true, errorCode: 'email_provider_failed' }],
])('does not treat unavailable or deferred transport as completed delivery', async (result, expected) => {
  runtime.send.mockResolvedValue(result); expect(await sendCoManagedCommentEmail(delivery())).toMatchObject(expected);
});

it.each(['en', 'en-AU', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt', 'xx', 'yy'])('renders customer-owned technician email in %s with native navigation and stable caller-owned delivery', async locale => {
  const { sendCoManagedCustomerCommentEmail } = await import('@alga-psa/jobs/handlers/coManagedCommentEmailTransport');
  runtime.locale.mockResolvedValue(locale);
  const source = delivery();
  const item = { ...source, replyToken: `cm2:${'b'.repeat(43)}`, message: { ...source.message, audience: 'organization_private' as const,
    resource: { tenant: source.tenant, kind: 'ticket' as const, id: source.message.resource.id } } };
  expect(await sendCoManagedCustomerCommentEmail(item)).toEqual({ status: 'delivered' });
  const params = runtime.send.mock.calls[0][0], content = await params.templateProcessor.process();
  expect(params).toMatchObject({ tenantId: source.tenant, userId: source.recipientUserId, retryPolicy: 'caller', headers: { 'Message-ID': source.messageId } });
  expect(content.text).toContain(`/msp/tickets/${source.message.resource.id}`);
  expect(content.text).not.toContain('/co-management/');
  expect(content.html).toContain('&lt;script&gt;');
  expect(runtime.locale).toHaveBeenCalledWith(item.tenant, { email: item.email, userId: item.recipientUserId, userType: 'internal' });
  expect(params).toMatchObject({ from: { email: 'support@example.test' }, replyTo: { email: 'intake@example.test' } });
  expect(params).not.toHaveProperty('replyContext'); expect(params).not.toHaveProperty('entityId');
  const { parseEmailReply } = await import('../../../../../shared/lib/email/replyParser');
  const textReply = parseEmailReply({ text: `Technician answer\n\n${content.text}` });
  expect(textReply.tokens?.conversationToken).toBe(item.replyToken); expect(textReply.sanitizedText).toBe('Technician answer');
  const htmlReply = parseEmailReply({ text: '', html: `<p>Technician answer</p>${content.html}` });
  expect(htmlReply.tokens?.conversationToken).toBe(item.replyToken); expect(htmlReply.sanitizedHtml).toBe('<p>Technician answer</p>');
  if (locale.startsWith('en')) expect(content.subject).toBe('New comment on a ticket');
});

it.each(['en', 'en-AU', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt', 'xx', 'yy'])('renders requester email in %s with committed tokens, customer locale and portal navigation', async locale => {
  const { sendCoManagedRequesterCommentEmail } = await import('@alga-psa/jobs/handlers/coManagedCommentEmailTransport');
  const { parseEmailReply } = await import('../../../../../shared/lib/email/replyParser');
  runtime.locale.mockResolvedValue(locale);
  const source = delivery(), clientId = randomUUID(), contactId = randomUUID();
  const item = { tenant: source.tenant, email: source.email, messageId: source.messageId, subtypeId: source.subtypeId,
    recipient: { kind: 'requester_contact' as const, tenant: source.tenant, clientId, contactId }, replyToken: `cm1:${'a'.repeat(43)}`,
    message: { ...source.message, audience: 'requester' as const, resource: { tenant: source.tenant, kind: 'ticket' as const, id: source.message.resource.id } } };
  const url = `https://customer.example.test/client-portal/tickets/${item.message.resource.id}`;
  runtime.routing.mockResolvedValue({ url, from: { email: 'support@example.test', name: 'Support' }, replyTo: { email: 'inbound@example.test' } });
  expect(await sendCoManagedRequesterCommentEmail(item)).toEqual({ status: 'delivered' });
  const params = runtime.send.mock.calls[0][0], content = await params.templateProcessor.process();
  expect(runtime.locale).toHaveBeenCalledWith(item.tenant, { email: item.email, clientId, userType: 'client' });
  expect(params).toMatchObject({ to: item.email, retryPolicy: 'caller', from: { email: 'support@example.test' }, replyTo: { email: 'inbound@example.test' }, headers: { 'Message-ID': item.messageId } });
  expect(params.userId).toBeUndefined(); expect(params).not.toHaveProperty('replyContext'); expect(params).not.toHaveProperty('entityId');
  expect(content.html).toContain(url); expect(content.html).not.toContain('/msp/'); expect(content.html).toContain('&lt;script&gt;');
  const textReply = parseEmailReply({ text: `Requester answer\n\n${content.text}` });
  expect(textReply.tokens?.conversationToken).toBe(item.replyToken);
  expect(textReply.sanitizedText).toBe('Requester answer');
  const htmlReply = parseEmailReply({ text: '', html: `<p>Requester answer</p>${content.html}` });
  expect(htmlReply.tokens?.conversationToken).toBe(item.replyToken);
  expect(htmlReply.sanitizedHtml).toBe('<p>Requester answer</p>');
  expect(parseEmailReply({ text: '', html: content.html }).tokens?.conversationToken).toBe(item.replyToken);
});

it('rejects malformed requester reply markers before rendering or transport', async () => {
  const { sendCoManagedRequesterCommentEmail } = await import('@alga-psa/jobs/handlers/coManagedCommentEmailTransport');
  await expect(sendCoManagedRequesterCommentEmail({ replyToken: 'cm1:" injected' } as any)).rejects.toThrow('Invalid requester reply token');
  expect(runtime.send).not.toHaveBeenCalled();
});

it.each([undefined, 'cm2:" injected', `cm1:${'a'.repeat(43)}`])('rejects invalid technician reply token %s before mailbox lookup or transport', async replyToken => {
  const { sendCoManagedCustomerCommentEmail } = await import('@alga-psa/jobs/handlers/coManagedCommentEmailTransport');
  await expect(sendCoManagedCustomerCommentEmail({ replyToken } as any)).rejects.toThrow('Invalid customer technician reply token');
  expect(runtime.mailbox).not.toHaveBeenCalled(); expect(runtime.send).not.toHaveBeenCalled();
});

it.each(['en', 'en-AU', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt', 'xx', 'yy'])('renders task email in %s with qualified navigation and no ticket reply authority', async locale => {
  runtime.locale.mockResolvedValue(locale);
  const source = delivery(), item: CoManagedEmailDelivery = { ...source, message: { resource: { ...source.message.resource, kind: 'project_task' },
    commentId: source.message.commentId, threadId: source.message.threadId, audience: 'shared_it', note: source.message.note, author: source.message.author,
    taskName: '<img src=x onerror=alert(1)>', projectName: 'Customer project' } };
  expect(await sendCoManagedCommentEmail(item)).toEqual({ status: 'delivered' });
  const params = runtime.send.mock.calls[0][0], content = await params.templateProcessor.process();
  expect(content.text).toContain(`/msp/co-management/tasks/${item.message.resource.tenant}/${item.message.resource.relationshipId}/${item.message.resource.id}`);
  expect(content.html).toContain('&lt;img'); expect(content.html).not.toContain('<script>'); expect(content.html).not.toContain('<img');
  expect(content.text).not.toContain('ALGA-REPLY-TOKEN'); expect(content.html).not.toContain('data-alga-reply-token');
  expect(runtime.mailbox).not.toHaveBeenCalled(); expect(params).toMatchObject({ tenantId: item.tenant, userId: item.recipientUserId, retryPolicy: 'caller', headers: { 'Message-ID': item.messageId } });
  if (locale.startsWith('en')) expect(content.subject).toBe('New comment on a task');
});

it('uses the admitted owner task path after separation and does not restore masked title or author fields', async () => {
  const source = delivery(), path = `/msp/projects/${randomUUID()}?phaseId=${randomUUID()}&taskId=${source.message.resource.id}`;
  const item: CoManagedEmailDelivery = { ...source, message: { resource: { ...source.message.resource, tenant: source.tenant, kind: 'project_task' },
    commentId: source.message.commentId, threadId: source.message.threadId, audience: 'organization_private', note: 'Only current content', ownerTaskPath: path } };
  await sendCoManagedCommentEmail(item);
  const content = await runtime.send.mock.calls[0][0].templateProcessor.process();
  expect(content.text).toContain(path); expect(content.text).not.toContain('/co-management/'); expect(content.text).not.toContain('Customer project'); expect(content.text).not.toContain('A < B');
});
