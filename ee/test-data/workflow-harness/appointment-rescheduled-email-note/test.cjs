const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "appointment-rescheduled-email-note",
    eventName: "APPOINTMENT_RESCHEDULED",
    schemaRef: "payload.AppointmentRescheduled.v1",
    pattern: "default"
  });
};
