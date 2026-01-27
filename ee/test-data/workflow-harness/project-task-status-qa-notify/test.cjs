const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-task-status-qa-notify",
    eventName: "PROJECT_TASK_STATUS_CHANGED",
    schemaRef: "payload.ProjectTaskStatusChanged.v1",
    pattern: "default"
  });
};
