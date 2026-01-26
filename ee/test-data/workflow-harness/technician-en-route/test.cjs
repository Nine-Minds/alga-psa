const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "technician-en-route",
    eventName: "TECHNICIAN_EN_ROUTE",
    schemaRef: "payload.TicketCreated.v1"
  });
};
