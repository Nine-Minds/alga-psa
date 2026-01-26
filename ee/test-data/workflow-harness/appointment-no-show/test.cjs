const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "appointment-no-show",
    eventName: "APPOINTMENT_NO_SHOW",
    schemaRef: "payload.TicketCreated.v1"
  });
};
