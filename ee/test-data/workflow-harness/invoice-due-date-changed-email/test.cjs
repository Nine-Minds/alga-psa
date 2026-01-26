const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "invoice-due-date-changed-email",
    eventName: "INVOICE_DUE_DATE_CHANGED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
