const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-created-chain-assign-comment-email",
    eventName: "TICKET_CREATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
