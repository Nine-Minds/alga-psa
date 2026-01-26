const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "appointment-request-declined",
    eventName: "APPOINTMENT_REQUEST_DECLINED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
