const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "task-comment-updated-crm-note",
    eventName: "TASK_COMMENT_UPDATED",
    schemaRef: "payload.TaskCommentUpdated.v1",
    pattern: "default"
  });
};
