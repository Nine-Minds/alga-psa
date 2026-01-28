const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-task-auto-assign",
    eventName: "PROJECT_TASK_ASSIGNED",
    schemaRef: "payload.ProjectTaskAssigned.v1"
  });
};
