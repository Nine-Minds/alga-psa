const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-approval-granted-advance",
    eventName: "PROJECT_APPROVAL_GRANTED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
