const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-assigned-kickoff-time-entry",
    eventName: "PROJECT_ASSIGNED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
