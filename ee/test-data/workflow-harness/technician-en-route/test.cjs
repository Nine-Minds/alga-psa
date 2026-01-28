const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "technician-en-route",
    eventName: "TECHNICIAN_EN_ROUTE",
    schemaRef: "payload.TechnicianEnRoute.v1",
    pattern: "default"
  });
};
