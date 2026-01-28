const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-closed-email-summary",
    eventName: "PROJECT_CLOSED",
    schemaRef: "payload.ProjectClosed.v1",
    pattern: "default"
  });
};
