const { runCallWorkflowBizFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runCallWorkflowBizFixture(ctx, {
    fixtureName: "project-task-completed-callworkflow-next",
    eventName: "PROJECT_TASK_COMPLETED",
    schemaRef: "payload.ProjectTaskCompleted.v1",
    kind: "project_task"
  });
};
