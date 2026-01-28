const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-split-create-child-ticket",
    eventName: "TICKET_SPLIT",
    schemaRef: "payload.TicketSplit.v1"
  });
};
