const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "appointment-rescheduled-send-email",
    eventName: "APPOINTMENT_RESCHEDULED",
    schemaRef: "payload.AppointmentRescheduled.v1"
  });
};
