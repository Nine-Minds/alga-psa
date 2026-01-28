const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-comment-added-create-time-entry",
    eventName: "TICKET_INTERNAL_NOTE_ADDED",
    schemaRef: "payload.TicketInternalNoteAdded.v1"
  });
};
