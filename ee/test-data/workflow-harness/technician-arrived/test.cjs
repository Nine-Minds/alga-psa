const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "technician-arrived",
    eventName: "TECHNICIAN_ARRIVED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
