const { runCallWorkflowFixture } = require('../_lib/callworkflow-fixture.cjs');

module.exports = async function run(ctx) {
  return runCallWorkflowFixture(ctx, {
    fixtureName: "project-task-completed-callworkflow",
    eventName: "PROJECT_TASK_COMPLETED",
    schemaRef: "payload.ProjectTaskCompleted.v1"
  });
};
