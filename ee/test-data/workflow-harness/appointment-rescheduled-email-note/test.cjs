const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "appointment-rescheduled-email-note",
    eventName: "APPOINTMENT_RESCHEDULED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
