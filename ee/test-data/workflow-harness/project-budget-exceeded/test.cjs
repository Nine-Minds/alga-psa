const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-budget-exceeded",
    eventName: "PROJECT_UPDATED",
    schemaRef: "payload.ProjectUpdated.v1",
    pattern: "default"
  });
};
