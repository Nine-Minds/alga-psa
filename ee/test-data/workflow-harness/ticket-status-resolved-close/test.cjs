const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-status-resolved-close",
    eventName: "TICKET_STATUS_CHANGED",
    schemaRef: "payload.TicketStatusChanged.v1",
    pattern: "default"
  });
};
