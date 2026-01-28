const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-status-blocked-create-note",
    eventName: "PROJECT_STATUS_CHANGED",
    schemaRef: "payload.ProjectStatusChanged.v1"
  });
};
