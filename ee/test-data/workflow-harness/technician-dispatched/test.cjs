const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "technician-dispatched",
    eventName: "TECHNICIAN_DISPATCHED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
