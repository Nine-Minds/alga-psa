const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-task-status-qa-notify",
    eventName: "PROJECT_TASK_STATUS_CHANGED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
