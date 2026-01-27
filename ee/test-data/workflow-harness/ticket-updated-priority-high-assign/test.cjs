const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-updated-priority-high-assign",
    eventName: "TICKET_PRIORITY_CHANGED",
    schemaRef: "payload.TicketPriorityChanged.v1"
  });
};
