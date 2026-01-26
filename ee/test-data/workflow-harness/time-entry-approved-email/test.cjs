const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "time-entry-approved-email",
    eventName: "TIME_ENTRY_APPROVED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
