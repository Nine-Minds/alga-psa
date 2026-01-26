const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "schedule-entry-created-after-hours",
    eventName: "SCHEDULE_ENTRY_CREATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
