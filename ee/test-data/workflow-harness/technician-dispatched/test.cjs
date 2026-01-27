const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "technician-dispatched",
    eventName: "TECHNICIAN_DISPATCHED",
    schemaRef: "payload.TechnicianDispatched.v1",
    pattern: "default"
  });
};
