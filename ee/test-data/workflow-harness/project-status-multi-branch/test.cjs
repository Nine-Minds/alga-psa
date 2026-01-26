const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-status-multi-branch",
    eventName: "PROJECT_STATUS_CHANGED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
