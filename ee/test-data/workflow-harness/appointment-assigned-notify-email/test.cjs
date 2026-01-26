const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "appointment-assigned-notify-email",
    eventName: "APPOINTMENT_ASSIGNED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
