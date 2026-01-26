const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "invoice-written-off-note",
    eventName: "INVOICE_WRITTEN_OFF",
    schemaRef: "payload.TicketCreated.v1"
  });
};
