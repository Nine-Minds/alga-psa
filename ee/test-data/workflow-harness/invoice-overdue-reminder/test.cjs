const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "invoice-overdue-reminder",
    eventName: "INVOICE_OVERDUE",
    schemaRef: "payload.TicketCreated.v1"
  });
};
