const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-message-added-auto-response",
    eventName: "TICKET_MESSAGE_ADDED",
    schemaRef: "payload.TicketMessageAdded.v1",
    pattern: "default"
  });
};
