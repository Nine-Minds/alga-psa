const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-created-send-password-reset",
    eventName: "TICKET_CREATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
