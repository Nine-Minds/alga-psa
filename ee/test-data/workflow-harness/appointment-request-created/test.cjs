const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "appointment-request-created",
    eventName: "APPOINTMENT_REQUEST_CREATED",
    schemaRef: "payload.AppointmentRequestCreated.v1",
    pattern: "default"
  });
};
