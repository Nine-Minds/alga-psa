const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-created-onboarding-email",
    eventName: "PROJECT_CREATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
