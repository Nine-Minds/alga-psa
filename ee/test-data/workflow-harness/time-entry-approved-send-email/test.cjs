const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "time-entry-approved-send-email",
    eventName: "TIME_ENTRY_APPROVED",
    schemaRef: "payload.TimeEntryApproved.v1"
  });
};
