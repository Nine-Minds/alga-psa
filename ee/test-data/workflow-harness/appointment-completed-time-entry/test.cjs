const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "appointment-completed-time-entry",
    eventName: "APPOINTMENT_COMPLETED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
