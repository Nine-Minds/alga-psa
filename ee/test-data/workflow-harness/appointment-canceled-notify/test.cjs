const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "appointment-canceled-notify",
    eventName: "APPOINTMENT_CANCELED",
    schemaRef: "payload.AppointmentCanceled.v1",
    pattern: "default"
  });
};
