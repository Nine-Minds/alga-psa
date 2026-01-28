const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-closed-create-crm-note",
    eventName: "TICKET_CLOSED",
    schemaRef: "payload.TicketClosed.v1"
  });
};
