const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "time-entry-approved-email",
    eventName: "TIME_ENTRY_APPROVED",
    schemaRef: "payload.TimeEntryApproved.v1",
    pattern: "default"
  });
};
