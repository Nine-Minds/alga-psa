const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-status-multi-branch",
    eventName: "PROJECT_STATUS_CHANGED",
    schemaRef: "payload.ProjectStatusChanged.v1",
    pattern: "multiBranch"
  });
};
