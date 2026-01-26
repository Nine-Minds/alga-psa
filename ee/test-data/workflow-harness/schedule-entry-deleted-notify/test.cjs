const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "schedule-entry-deleted-notify",
    eventName: "SCHEDULE_ENTRY_DELETED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
