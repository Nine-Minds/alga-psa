const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-comment-added-internal-audit-time",
    eventName: "TICKET_INTERNAL_NOTE_ADDED",
    schemaRef: "payload.TicketInternalNoteAdded.v1",
    pattern: "default"
  });
};
