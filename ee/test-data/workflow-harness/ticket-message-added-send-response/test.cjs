const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-message-added-send-response",
    eventName: "TICKET_MESSAGE_ADDED",
    schemaRef: "payload.TicketMessageAdded.v1"
  });
};
