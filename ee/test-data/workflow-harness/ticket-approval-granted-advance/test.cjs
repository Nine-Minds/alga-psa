const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-approval-granted-advance",
    eventName: "TICKET_APPROVAL_GRANTED",
    schemaRef: "payload.TicketApprovalGranted.v1",
    pattern: "default"
  });
};
