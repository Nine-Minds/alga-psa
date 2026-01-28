const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-updated-email-trycatch",
    eventName: "PROJECT_UPDATED",
    schemaRef: "payload.ProjectUpdated.v1",
    pattern: "tryCatch"
  });
};
