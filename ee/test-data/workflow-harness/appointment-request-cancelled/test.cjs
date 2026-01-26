const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "appointment-request-cancelled",
    eventName: "APPOINTMENT_REQUEST_CANCELLED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
