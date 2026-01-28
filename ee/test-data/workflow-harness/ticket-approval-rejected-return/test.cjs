const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-approval-rejected-return",
    eventName: "TICKET_APPROVAL_REJECTED",
    schemaRef: "payload.TicketApprovalRejected.v1",
    pattern: "default"
  });
};
