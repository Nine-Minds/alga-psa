const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-approval-requested-notify",
    eventName: "TICKET_APPROVAL_REQUESTED",
    schemaRef: "payload.TicketApprovalRequested.v1",
    pattern: "default"
  });
};
