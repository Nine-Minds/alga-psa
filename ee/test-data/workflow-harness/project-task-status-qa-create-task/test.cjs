const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-task-status-qa-create-task",
    eventName: "PROJECT_TASK_STATUS_CHANGED",
    schemaRef: "payload.ProjectTaskStatusChanged.v1"
  });
};
