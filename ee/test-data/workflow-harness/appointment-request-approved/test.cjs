const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "appointment-request-approved",
    eventName: "APPOINTMENT_REQUEST_APPROVED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
