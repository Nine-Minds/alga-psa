const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "technician-dispatched-send-email",
    eventName: "TECHNICIAN_DISPATCHED",
    schemaRef: "payload.TechnicianDispatched.v1"
  });
};
