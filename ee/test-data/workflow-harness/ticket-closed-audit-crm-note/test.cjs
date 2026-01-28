const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-closed-audit-crm-note",
    eventName: "TICKET_CLOSED",
    schemaRef: "payload.TicketClosed.v1",
    pattern: "default"
  });
};
