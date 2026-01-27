const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "schedule-entry-created-after-hours",
    eventName: "SCHEDULE_ENTRY_CREATED",
    schemaRef: "payload.ScheduleEntryCreated.v1",
    pattern: "default"
  });
};
