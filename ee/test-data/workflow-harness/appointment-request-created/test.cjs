const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "appointment-request-created",
    eventName: "APPOINTMENT_REQUEST_CREATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
