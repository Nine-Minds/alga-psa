const { runCallWorkflowBizFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runCallWorkflowBizFixture(ctx, {
    fixtureName: "project-created-callworkflow-create-tasks",
    eventName: "PROJECT_CREATED",
    schemaRef: "payload.ProjectCreated.v1",
    kind: "project_task"
  });
};
