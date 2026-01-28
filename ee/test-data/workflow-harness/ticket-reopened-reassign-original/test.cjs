const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-reopened-reassign-original",
    eventName: "TICKET_REOPENED",
    schemaRef: "payload.TicketReopened.v1",
    pattern: "default"
  });
};
