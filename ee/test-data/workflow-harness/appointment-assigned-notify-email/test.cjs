const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "appointment-assigned-notify-email",
    eventName: "APPOINTMENT_ASSIGNED",
    schemaRef: "payload.AppointmentAssigned.v1",
    pattern: "default"
  });
};
