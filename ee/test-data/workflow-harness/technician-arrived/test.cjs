const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "technician-arrived",
    eventName: "TECHNICIAN_ARRIVED",
    schemaRef: "payload.TechnicianArrived.v1",
    pattern: "default"
  });
};
