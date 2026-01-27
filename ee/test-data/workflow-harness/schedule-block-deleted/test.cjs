const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "schedule-block-deleted",
    eventName: "SCHEDULE_BLOCK_DELETED",
    schemaRef: "payload.ScheduleBlockDeleted.v1",
    pattern: "default"
  });
};
