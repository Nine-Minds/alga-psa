const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "task-comment-added-update-status",
    eventName: "TASK_COMMENT_ADDED",
    schemaRef: "payload.TaskCommentAdded.v1"
  });
};
