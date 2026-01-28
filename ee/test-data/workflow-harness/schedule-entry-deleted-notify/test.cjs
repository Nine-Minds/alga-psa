const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "schedule-entry-deleted-notify",
    eventName: "SCHEDULE_ENTRY_DELETED",
    schemaRef: "payload.ScheduleEntryDeleted.v1",
    pattern: "default"
  });
};
