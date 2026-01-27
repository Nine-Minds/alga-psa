const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "schedule-entry-updated-email-note",
    eventName: "SCHEDULE_ENTRY_UPDATED",
    schemaRef: "payload.ScheduleEntryUpdated.v1",
    pattern: "default"
  });
};
