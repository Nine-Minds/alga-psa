const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-task-dependency-unblocked",
    eventName: "PROJECT_TASK_DEPENDENCY_UNBLOCKED",
    schemaRef: "payload.ProjectTaskDependencyUnblocked.v1",
    pattern: "default"
  });
};
