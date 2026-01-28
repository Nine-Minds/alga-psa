const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "schedule-entry-after-hours-create-task",
    eventName: "SCHEDULE_ENTRY_CREATED",
    schemaRef: "payload.ScheduleEntryCreated.v1"
  });
};
