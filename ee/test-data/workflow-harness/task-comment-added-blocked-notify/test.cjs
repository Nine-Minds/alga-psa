const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "task-comment-added-blocked-notify",
    eventName: "TASK_COMMENT_ADDED",
    schemaRef: "payload.TaskCommentAdded.v1",
    pattern: "default"
  });
};
