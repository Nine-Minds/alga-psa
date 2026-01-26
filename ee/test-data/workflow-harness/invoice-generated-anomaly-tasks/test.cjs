const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "invoice-generated-anomaly-tasks",
    eventName: "INVOICE_GENERATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
