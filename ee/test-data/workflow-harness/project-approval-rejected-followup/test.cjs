const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-approval-rejected-followup",
    eventName: "PROJECT_APPROVAL_REJECTED",
    schemaRef: "payload.ProjectApprovalRejected.v1",
    pattern: "default"
  });
};
