const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-approval-rejected-create-task",
    eventName: "PROJECT_APPROVAL_REJECTED",
    schemaRef: "payload.ProjectApprovalRejected.v1"
  });
};
