const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-task-additional-agent-comment",
    eventName: "PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED",
    schemaRef: "payload.ProjectTaskAdditionalAgentAssigned.v1"
  });
};
