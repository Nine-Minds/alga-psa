const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-budget-exceeded-create-task",
    eventName: "PROJECT_UPDATED",
    schemaRef: "payload.ProjectUpdated.v1"
  });
};
