const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "schedule-block-deleted",
    eventName: "SCHEDULE_BLOCK_DELETED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
