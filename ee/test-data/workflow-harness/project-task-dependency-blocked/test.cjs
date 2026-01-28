const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-task-dependency-blocked",
    eventName: "PROJECT_TASK_DEPENDENCY_BLOCKED",
    schemaRef: "payload.ProjectTaskDependencyBlocked.v1",
    pattern: "default"
  });
};
