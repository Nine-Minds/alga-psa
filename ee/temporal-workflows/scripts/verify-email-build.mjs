import assert from 'node:assert/strict';

// Import the emitted activity entrypoint so Node follows the same aliases
// produced by the worker's tsc-alias build, including its reachable SLA module.
const activities = await import('../dist/ee/temporal-workflows/src/activities/sla-activities.js');
const notificationModule = await import('../dist/packages/notifications/src/notifications/email.js');
const escalationModule = await import('../dist/packages/sla/src/services/escalationService.js');
const emailPackage = await import('@alga-psa/email');

assert.equal(typeof activities.checkAndEscalate, 'function');
assert.equal(typeof escalationModule.escalateTicket, 'function');
assert.equal(typeof notificationModule.getEmailNotificationService, 'function');
const workerNotificationService = notificationModule.getEmailNotificationService();
assert.ok(workerNotificationService instanceof notificationModule.EmailNotificationService,
  'the email module resolved by the emitted SLA activity graph must provide the real notification service');
assert.equal(typeof workerNotificationService.sendNotification, 'function');
assert.equal(typeof emailPackage.TenantEmailOutboundAdapter, 'function');

const received = [];
const adapter = new emailPackage.TenantEmailOutboundAdapter(() => ({
  sendEmail: async (message) => {
    received.push(message);
    return { success: true, messageId: 'controlled-worker-smtp-id' };
  },
}));
const notificationConsumer = new notificationModule.EmailNotificationService(adapter);
const tableRows = {
  notification_subtypes: { id: 71, category_id: 9 },
  tenant_notification_category_settings: null,
  user_notification_preferences: null,
};
const fakeKnex = (tableName) => ({
  where() { return this; },
  select() { return this; },
  first() { return Promise.resolve(tableRows[tableName] ?? null); },
  insert() { return Promise.resolve([]); },
});
fakeKnex.fn = { now: () => new Date() };
notificationConsumer.getTenantKnex = async () => fakeKnex;
notificationConsumer.getSettings = async () => ({ is_enabled: true });
notificationConsumer.getEffectiveTemplate = async () => ({
  subject: 'SLA escalation {{ticketNumber}}',
  html_content: '<p>{{ticketTitle}}</p>',
});
assert.deepEqual(await notificationConsumer.sendNotification({
  tenant: 'worker-build-tenant',
  userId: 'manager',
  subtypeId: 71,
  emailAddress: 'manager@example.test',
  templateName: 'sla-escalation',
  data: { ticketNumber: 'BUILD-71', ticketTitle: 'Emitted worker path' },
  mailClass: 'ticket',
  boardId: 'board-from-ticket',
}), { status: 'sent', messageId: 'controlled-worker-smtp-id' });

assert.equal(received[0].boardId, 'board-from-ticket');
assert.equal(received[0].mailClass, 'ticket');
assert.equal(received[0].to, 'manager@example.test');
assert.equal(received[0].templateProcessor.subject, 'SLA escalation BUILD-71');
console.log('Built worker escalation graph resolved the real notification consumer, which rendered and sent through the board-routed controlled transport.');
