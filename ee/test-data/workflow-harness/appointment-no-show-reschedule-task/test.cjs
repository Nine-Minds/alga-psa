const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "appointment-no-show-reschedule-task",
    eventName: "APPOINTMENT_NO_SHOW",
    schemaRef: "payload.AppointmentNoShow.v1"
  });
};
