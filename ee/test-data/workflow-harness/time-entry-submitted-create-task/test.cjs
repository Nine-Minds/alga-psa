const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "time-entry-submitted-create-task",
    eventName: "TIME_ENTRY_SUBMITTED",
    schemaRef: "payload.TimeEntrySubmitted.v1"
  });
};
