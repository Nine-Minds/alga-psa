const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "appointment-no-show",
    eventName: "APPOINTMENT_NO_SHOW",
    schemaRef: "payload.AppointmentNoShow.v1",
    pattern: "default"
  });
};
