const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-updated-priority-high-notify",
    eventName: "TICKET_PRIORITY_CHANGED",
    schemaRef: "payload.TicketPriorityChanged.v1",
    pattern: "default"
  });
};
