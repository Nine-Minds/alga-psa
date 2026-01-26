const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "payment-applied-partial-followup",
    eventName: "PAYMENT_APPLIED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
