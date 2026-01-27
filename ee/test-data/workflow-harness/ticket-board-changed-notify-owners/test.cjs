const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-board-changed-notify-owners",
    eventName: "TICKET_UPDATED",
    schemaRef: "payload.TicketUpdated.v1",
    pattern: "default"
  });
};
