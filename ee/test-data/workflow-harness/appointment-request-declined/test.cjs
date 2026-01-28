const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "appointment-request-declined",
    eventName: "APPOINTMENT_REQUEST_DECLINED",
    schemaRef: "payload.AppointmentRequestDeclined.v1",
    pattern: "default"
  });
};
