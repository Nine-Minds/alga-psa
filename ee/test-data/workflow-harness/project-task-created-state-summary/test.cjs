const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-task-created-state-summary",
    eventName: "PROJECT_TASK_CREATED",
    schemaRef: "payload.ProjectTaskCreated.v1",
    pattern: "default"
  });
};
