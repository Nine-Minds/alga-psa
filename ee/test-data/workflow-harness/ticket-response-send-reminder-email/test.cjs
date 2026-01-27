const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-response-send-reminder-email",
    eventName: "TICKET_RESPONSE_STATE_CHANGED",
    schemaRef: "payload.TicketResponseStateChanged.v1"
  });
};
