const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-created-error-creates-comment",
    eventName: "TICKET_CREATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
