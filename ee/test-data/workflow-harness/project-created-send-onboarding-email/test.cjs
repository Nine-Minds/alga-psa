const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-created-send-onboarding-email",
    eventName: "PROJECT_CREATED",
    schemaRef: "payload.ProjectCreated.v1"
  });
};
