const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "schedule-block-deleted-update-tasks",
    eventName: "SCHEDULE_BLOCK_DELETED",
    schemaRef: "payload.ScheduleBlockDeleted.v1"
  });
};
