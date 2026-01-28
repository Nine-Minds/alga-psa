const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-task-additional-agent-assigned",
    eventName: "PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED",
    schemaRef: "payload.ProjectTaskAdditionalAgentAssigned.v1",
    pattern: "default"
  });
};
