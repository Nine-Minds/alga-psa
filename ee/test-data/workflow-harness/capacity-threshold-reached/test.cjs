const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "capacity-threshold-reached",
    eventName: "CAPACITY_THRESHOLD_REACHED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
