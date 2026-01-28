const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "capacity-threshold-reached",
    eventName: "CAPACITY_THRESHOLD_REACHED",
    schemaRef: "payload.CapacityThresholdReached.v1",
    pattern: "default"
  });
};
