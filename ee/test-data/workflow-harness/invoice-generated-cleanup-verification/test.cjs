const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "invoice-generated-cleanup-verification",
    eventName: "INVOICE_GENERATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
