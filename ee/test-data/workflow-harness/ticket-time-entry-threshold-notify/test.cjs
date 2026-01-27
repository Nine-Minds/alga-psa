const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-time-entry-threshold-notify",
    eventName: "TICKET_TIME_ENTRY_ADDED",
    schemaRef: "payload.TicketTimeEntryAdded.v1",
    pattern: "default"
  });
};
