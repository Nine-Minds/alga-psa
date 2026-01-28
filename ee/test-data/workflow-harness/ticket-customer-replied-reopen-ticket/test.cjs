const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-customer-replied-reopen-ticket",
    eventName: "TICKET_CUSTOMER_REPLIED",
    schemaRef: "payload.TicketCustomerReplied.v1"
  });
};
