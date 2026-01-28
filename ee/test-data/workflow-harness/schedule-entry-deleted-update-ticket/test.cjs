const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "schedule-entry-deleted-update-ticket",
    eventName: "SCHEDULE_ENTRY_DELETED",
    schemaRef: "payload.ScheduleEntryDeleted.v1"
  });
};
