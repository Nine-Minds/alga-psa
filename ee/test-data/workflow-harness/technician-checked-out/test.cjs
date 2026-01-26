const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "technician-checked-out",
    eventName: "TECHNICIAN_CHECKED_OUT",
    schemaRef: "payload.TicketCreated.v1"
  });
};
