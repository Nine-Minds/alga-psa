const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-created-secretref-redaction",
    eventName: "TICKET_CREATED",
    schemaRef: "payload.TicketCreated.v1",
    pattern: "default"
  });
};
