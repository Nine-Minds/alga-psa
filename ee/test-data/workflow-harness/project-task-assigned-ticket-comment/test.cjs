const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-task-assigned-ticket-comment",
    eventName: "PROJECT_TASK_ASSIGNED",
    schemaRef: "payload.ProjectTaskAssigned.v1",
    pattern: "default"
  });
};
