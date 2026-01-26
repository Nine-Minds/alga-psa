const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-task-created-auto-assign",
    eventName: "PROJECT_TASK_CREATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
