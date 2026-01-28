const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "technician-arrived-update-ticket",
    eventName: "TECHNICIAN_ARRIVED",
    schemaRef: "payload.TechnicianArrived.v1"
  });
};
