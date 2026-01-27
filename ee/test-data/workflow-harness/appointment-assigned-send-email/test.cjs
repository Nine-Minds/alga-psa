const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "appointment-assigned-send-email",
    eventName: "APPOINTMENT_ASSIGNED",
    schemaRef: "payload.AppointmentAssigned.v1"
  });
};
