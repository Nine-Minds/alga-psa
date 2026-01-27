const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-closed-send-summary-email",
    eventName: "PROJECT_CLOSED",
    schemaRef: "payload.ProjectClosed.v1"
  });
};
