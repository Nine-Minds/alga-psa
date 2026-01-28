const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "project-created-tasks-idempotent",
    eventName: "PROJECT_CREATED",
    schemaRef: "payload.ProjectCreated.v1",
    pattern: "idempotent"
  });
};
