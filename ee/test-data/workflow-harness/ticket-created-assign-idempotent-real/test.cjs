const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-created-assign-idempotent-real",
    eventName: "TICKET_CREATED",
    schemaRef: "payload.TicketCreated.v1",
    pattern: "idempotent"
  });
};
