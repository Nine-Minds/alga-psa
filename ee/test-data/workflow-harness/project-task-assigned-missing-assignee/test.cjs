const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-task-assigned-missing-assignee",
    eventName: "PROJECT_TASK_ASSIGNED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
