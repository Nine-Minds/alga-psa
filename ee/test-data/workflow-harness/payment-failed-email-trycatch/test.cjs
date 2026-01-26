const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "payment-failed-email-trycatch",
    eventName: "PAYMENT_FAILED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
