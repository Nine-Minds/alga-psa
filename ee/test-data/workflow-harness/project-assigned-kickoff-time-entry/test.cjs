const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-assigned-kickoff-time-entry",
    eventName: "PROJECT_ASSIGNED",
    schemaRef: "payload.ProjectAssigned.v1",
    pattern: "default"
  });
};
