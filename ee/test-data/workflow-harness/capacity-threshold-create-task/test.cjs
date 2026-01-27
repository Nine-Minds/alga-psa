const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "capacity-threshold-create-task",
    eventName: "CAPACITY_THRESHOLD_REACHED",
    schemaRef: "payload.CapacityThresholdReached.v1"
  });
};
