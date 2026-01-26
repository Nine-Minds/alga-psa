const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "schedule-entry-updated-email-note",
    eventName: "SCHEDULE_ENTRY_UPDATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
