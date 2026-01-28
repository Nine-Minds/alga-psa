const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "schedule-entry-updated-send-email",
    eventName: "SCHEDULE_ENTRY_UPDATED",
    schemaRef: "payload.ScheduleEntryUpdated.v1"
  });
};
