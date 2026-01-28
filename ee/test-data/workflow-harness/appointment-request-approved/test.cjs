const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "appointment-request-approved",
    eventName: "APPOINTMENT_REQUEST_APPROVED",
    schemaRef: "payload.AppointmentRequestApproved.v1",
    pattern: "default"
  });
};
