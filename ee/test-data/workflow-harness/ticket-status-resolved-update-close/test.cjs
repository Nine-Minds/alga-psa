const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-status-resolved-update-close",
    eventName: "TICKET_STATUS_CHANGED",
    schemaRef: "payload.TicketStatusChanged.v1"
  });
};
