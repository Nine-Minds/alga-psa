const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-time-entry-threshold-escalate",
    eventName: "TICKET_TIME_ENTRY_ADDED",
    schemaRef: "payload.TicketTimeEntryAdded.v1"
  });
};
