const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "appointment-completed-create-time-entry",
    eventName: "APPOINTMENT_COMPLETED",
    schemaRef: "payload.AppointmentCompleted.v1"
  });
};
