const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-approval-rejected-reassign",
    eventName: "TICKET_APPROVAL_REJECTED",
    schemaRef: "payload.TicketApprovalRejected.v1"
  });
};
