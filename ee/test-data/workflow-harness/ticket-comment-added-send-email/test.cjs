const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-comment-added-send-email",
    eventName: "TICKET_COMMENT_ADDED",
    schemaRef: "payload.TicketCommentAdded.v1"
  });
};
