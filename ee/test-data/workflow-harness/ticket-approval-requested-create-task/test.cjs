const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-approval-requested-create-task",
    eventName: "TICKET_APPROVAL_REQUESTED",
    schemaRef: "payload.TicketApprovalRequested.v1"
  });
};
