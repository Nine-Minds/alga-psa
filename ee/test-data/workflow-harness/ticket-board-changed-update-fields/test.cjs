const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-board-changed-update-fields",
    eventName: "TICKET_UPDATED",
    schemaRef: "payload.TicketUpdated.v1"
  });
};
