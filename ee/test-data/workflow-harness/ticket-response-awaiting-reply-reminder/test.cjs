const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-response-awaiting-reply-reminder",
    eventName: "TICKET_RESPONSE_STATE_CHANGED",
    schemaRef: "payload.TicketResponseStateChanged.v1",
    pattern: "default"
  });
};
