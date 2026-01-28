const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "technician-checked-out",
    eventName: "TECHNICIAN_CHECKED_OUT",
    schemaRef: "payload.TechnicianCheckedOut.v1",
    pattern: "default"
  });
};
