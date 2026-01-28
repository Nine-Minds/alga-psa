const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-customer-replied-ack",
    eventName: "TICKET_CUSTOMER_REPLIED",
    schemaRef: "payload.TicketCustomerReplied.v1",
    pattern: "default"
  });
};
