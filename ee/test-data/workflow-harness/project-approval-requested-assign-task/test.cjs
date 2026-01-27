const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-approval-requested-assign-task",
    eventName: "PROJECT_APPROVAL_REQUESTED",
    schemaRef: "payload.ProjectApprovalRequested.v1"
  });
};
