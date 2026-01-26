const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "time-entry-submitted-notify",
    eventName: "TIME_ENTRY_SUBMITTED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
