const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-task-created-update-project",
    eventName: "PROJECT_TASK_CREATED",
    schemaRef: "payload.ProjectTaskCreated.v1"
  });
};
