const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-approval-rejected-followup",
    eventName: "PROJECT_APPROVAL_REJECTED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
