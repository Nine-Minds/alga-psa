const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-task-dependency-add-comment",
    eventName: "PROJECT_TASK_DEPENDENCY_BLOCKED",
    schemaRef: "payload.ProjectTaskDependencyBlocked.v1"
  });
};
