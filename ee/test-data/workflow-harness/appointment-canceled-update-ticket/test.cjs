const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "appointment-canceled-update-ticket",
    eventName: "APPOINTMENT_CANCELED",
    schemaRef: "payload.AppointmentCanceled.v1"
  });
};
