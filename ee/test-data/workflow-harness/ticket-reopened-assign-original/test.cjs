const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-reopened-assign-original",
    eventName: "TICKET_REOPENED",
    schemaRef: "payload.TicketReopened.v1"
  });
};
