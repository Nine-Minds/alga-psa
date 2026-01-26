const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-updated-email-trycatch",
    eventName: "PROJECT_UPDATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
