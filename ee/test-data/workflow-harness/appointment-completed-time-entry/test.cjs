const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "appointment-completed-time-entry",
    eventName: "APPOINTMENT_COMPLETED",
    schemaRef: "payload.AppointmentCompleted.v1",
    pattern: "default"
  });
};
