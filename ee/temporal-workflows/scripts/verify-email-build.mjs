import assert from 'node:assert/strict';

// Import the emitted activity entrypoint so Node follows the same aliases
// produced by the worker's tsc-alias build, including its reachable SLA module.
const activities = await import('../dist/ee/temporal-workflows/src/activities/sla-activities.js');
const notificationModule = await import('../dist/packages/notifications/src/notifications/email.js');
const emailPackage = await import('@alga-psa/email');

assert.equal(typeof activities.checkAndEscalate, 'function');
assert.equal(typeof notificationModule.getEmailNotificationService, 'function');
assert.ok(notificationModule.getEmailNotificationService() instanceof notificationModule.EmailNotificationService);
assert.equal(typeof emailPackage.TenantEmailOutboundAdapter, 'function');

const received = [];
const adapter = new emailPackage.TenantEmailOutboundAdapter(() => ({
  sendEmail: async (message) => {
    received.push(message);
    return { success: true, messageId: 'controlled-worker-smtp-id' };
  },
}));
const result = await adapter.send({
  tenantId: 'worker-build-tenant',
  to: 'manager@example.test',
  subject: 'SLA escalation',
  html: '<p>Worker build delivery</p>',
  text: 'Worker build delivery',
  mailClass: 'ticket',
  boardId: 'board-from-ticket',
});

assert.deepEqual(result, { status: 'sent', messageId: 'controlled-worker-smtp-id' });
assert.equal(received[0].boardId, 'board-from-ticket');
assert.equal(received[0].mailClass, 'ticket');
console.log('Built worker SLA graph resolves the real notification service and operational board-routed mail adapter.');
