const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-task-additional-agent-assigned",
    eventName: "PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
