const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-approval-granted-update-status",
    eventName: "PROJECT_APPROVAL_GRANTED",
    schemaRef: "payload.ProjectApprovalGranted.v1"
  });
};
