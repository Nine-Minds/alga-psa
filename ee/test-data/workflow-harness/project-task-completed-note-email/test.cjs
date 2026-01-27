const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-task-completed-note-email",
    eventName: "PROJECT_TASK_COMPLETED",
    schemaRef: "payload.ProjectTaskCompleted.v1",
    pattern: "default"
  });
};
