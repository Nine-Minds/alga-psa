const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-approval-granted-advance-status",
    eventName: "TICKET_APPROVAL_GRANTED",
    schemaRef: "payload.TicketApprovalGranted.v1"
  });
};
