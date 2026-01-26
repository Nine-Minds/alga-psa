const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "invoice-sent-notify",
    eventName: "INVOICE_SENT",
    schemaRef: "payload.TicketCreated.v1"
  });
};
