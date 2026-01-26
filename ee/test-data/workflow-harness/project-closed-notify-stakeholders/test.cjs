const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-closed-notify-stakeholders",
    eventName: "PROJECT_CLOSED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
