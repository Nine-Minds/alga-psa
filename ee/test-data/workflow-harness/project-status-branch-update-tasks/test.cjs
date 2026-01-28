const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-status-branch-update-tasks",
    eventName: "PROJECT_STATUS_CHANGED",
    schemaRef: "payload.ProjectStatusChanged.v1",
    pattern: "multiBranch"
  });
};
