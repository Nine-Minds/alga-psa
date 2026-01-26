const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "invoice-status-multi-branch",
    eventName: "INVOICE_STATUS_CHANGED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
