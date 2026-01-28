const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-split-create-and-link",
    eventName: "TICKET_SPLIT",
    schemaRef: "payload.TicketSplit.v1",
    pattern: "default"
  });
};
