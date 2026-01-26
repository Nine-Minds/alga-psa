const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-task-completed-note-email",
    eventName: "PROJECT_TASK_COMPLETED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
