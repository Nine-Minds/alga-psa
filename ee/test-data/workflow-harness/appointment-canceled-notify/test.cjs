const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "appointment-canceled-notify",
    eventName: "APPOINTMENT_CANCELED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
