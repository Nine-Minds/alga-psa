const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-assigned-create-time-entry",
    eventName: "PROJECT_ASSIGNED",
    schemaRef: "payload.ProjectAssigned.v1"
  });
};
