const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-created-dotted-keys-update",
    eventName: "TICKET_CREATED",
    schemaRef: "payload.TicketCreated.v1",
    pattern: "default"
  });
};
