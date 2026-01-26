const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-approval-requested",
    eventName: "PROJECT_APPROVAL_REQUESTED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
