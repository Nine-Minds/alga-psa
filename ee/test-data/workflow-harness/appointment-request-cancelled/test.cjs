const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "appointment-request-cancelled",
    eventName: "APPOINTMENT_REQUEST_CANCELLED",
    schemaRef: "payload.AppointmentRequestCancelled.v1",
    pattern: "default"
  });
};
