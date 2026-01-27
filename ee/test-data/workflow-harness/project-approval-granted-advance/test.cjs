const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-approval-granted-advance",
    eventName: "PROJECT_APPROVAL_GRANTED",
    schemaRef: "payload.ProjectApprovalGranted.v1",
    pattern: "default"
  });
};
