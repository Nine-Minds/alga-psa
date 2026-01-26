const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-budget-exceeded",
    eventName: "PROJECT_UPDATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
