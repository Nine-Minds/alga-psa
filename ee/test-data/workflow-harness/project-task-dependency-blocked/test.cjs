const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-task-dependency-blocked",
    eventName: "PROJECT_TASK_DEPENDENCY_BLOCKED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
