const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-merged-add-comment",
    eventName: "TICKET_MERGED",
    schemaRef: "payload.TicketMerged.v1"
  });
};
