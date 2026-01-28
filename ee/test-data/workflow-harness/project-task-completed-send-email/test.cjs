const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-task-completed-send-email",
    eventName: "PROJECT_TASK_COMPLETED",
    schemaRef: "payload.ProjectTaskCompleted.v1"
  });
};
