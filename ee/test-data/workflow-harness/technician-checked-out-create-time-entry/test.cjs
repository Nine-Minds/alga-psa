const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "technician-checked-out-create-time-entry",
    eventName: "TECHNICIAN_CHECKED_OUT",
    schemaRef: "payload.TechnicianCheckedOut.v1"
  });
};
