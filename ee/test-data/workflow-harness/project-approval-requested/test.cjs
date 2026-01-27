const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-approval-requested",
    eventName: "PROJECT_APPROVAL_REQUESTED",
    schemaRef: "payload.ProjectApprovalRequested.v1",
    pattern: "default"
  });
};
