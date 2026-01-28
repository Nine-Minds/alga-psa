const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-updated-send-email",
    eventName: "PROJECT_UPDATED",
    schemaRef: "payload.ProjectUpdated.v1",
    pattern: "tryCatch"
  });
};
