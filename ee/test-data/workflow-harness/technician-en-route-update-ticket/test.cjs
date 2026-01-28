const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "technician-en-route-update-ticket",
    eventName: "TECHNICIAN_EN_ROUTE",
    schemaRef: "payload.TechnicianEnRoute.v1"
  });
};
