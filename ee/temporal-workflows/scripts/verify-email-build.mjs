import assert from 'node:assert/strict';
import { buildFixture, flushBuildHooks } from './worker-email-test-runtime.mjs';

// Import the emitted activity entrypoint and the exact emitted escalation
// module it reaches after tsc-alias resolution. The verifier never imports the
// notification module by path: it obtains the consumer through the binding
// imported by escalationService itself.
const activities = await import('../dist/ee/temporal-workflows/src/activities/sla-activities.js');
const escalationModule = await import('../dist/packages/sla/src/services/escalationService.js');
const slaNotificationModule = await import('../dist/packages/sla/src/services/slaNotificationService.js');

assert.equal(typeof activities.checkAndEscalate, 'function');
assert.equal(typeof escalationModule.escalateTicket, 'function');
assert.equal(typeof escalationModule.getEscalationEmailNotificationService, 'function');
assert.equal(typeof slaNotificationModule.sendSlaNotification, 'function');

const received = buildFixture.controlledMessages;
const emailService = escalationModule.getEscalationEmailNotificationService();
emailService.outboundMail = {
  async send(message) {
    received.push(message);
    return { status: 'sent', messageId: 'controlled-worker-smtp-id' };
  },
};
emailService.resolveLocale = async () => 'en';
emailService.getTenantKnex = async () => buildFixture.fakeKnex;
emailService.getSettings = async () => ({ is_enabled: true });
emailService.getEffectiveTemplate = async () => ({
  subject: 'SLA escalation {{ticketNumber}}',
  html_content: '<p>{{ticketTitle}}</p>',
});

const trx = { fn: buildFixture.fakeKnex.fn, raw: buildFixture.fakeKnex.raw };
const escalation = await escalationModule.escalateTicket(
  trx,
  buildFixture.tenantId,
  buildFixture.ticketId,
  1,
);
assert.equal(escalation.success, true);
assert.equal(buildFixture.auditRows.length, 1);
const auditData = () => JSON.parse(buildFixture.auditRows[0].event_data);
assert.equal(auditData().notifications.email, 'queued', 'the committed audit row starts queued');

// Flush the actual after-commit callback registered by emitted escalationService.
await flushBuildHooks(trx);
assert.equal(auditData().notifications.email, 'sent');
assert.equal(auditData().notifications.emailMessageId, 'controlled-worker-smtp-id');
assert.equal(received.length, 1);
assert.equal(received[0].boardId, buildFixture.ticket.board_id);
assert.equal(received[0].mailClass, 'ticket');
assert.equal(received[0].to, buildFixture.manager.manager_email);
assert.equal(received[0].subject, 'SLA escalation BUILD-222');

const beforeSlaNotification = received.length;
const slaResult = await slaNotificationModule.sendSlaNotification(trx, {
  tenant: buildFixture.tenantId,
  ticketId: buildFixture.ticketId,
  ticketNumber: 'BUILD-222',
  ticketTitle: 'Built SLA notification consumer',
  clientName: 'Build Fixture',
  priorityName: 'High',
  assigneeId: buildFixture.manager.manager_user_id,
  boardId: buildFixture.ticket.board_id,
  slaPolicyId: '66666666-6666-4666-8666-666666666666',
  thresholdPercent: 50,
  slaType: 'response',
  remainingMinutes: 30,
  dueAt: new Date('2026-11-01T01:00:00.000Z'),
});
assert.equal(slaResult.success, true);
assert.equal(slaResult.emailSent, 1);
await flushBuildHooks(trx);
assert.equal(received.length, beforeSlaNotification + 1);
assert.equal(received[beforeSlaNotification].boardId, buildFixture.ticket.board_id);
assert.equal(received[beforeSlaNotification].mailClass, 'ticket');
assert.equal(received[beforeSlaNotification].to, buildFixture.manager.manager_email);
console.log('Emitted escalation and SLA notification consumers both delivered through their imported email binding after commit.');
