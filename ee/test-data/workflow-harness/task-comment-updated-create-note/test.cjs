const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "task-comment-updated-create-note",
    eventName: "TASK_COMMENT_UPDATED",
    schemaRef: "payload.TaskCommentUpdated.v1"
  });
};
