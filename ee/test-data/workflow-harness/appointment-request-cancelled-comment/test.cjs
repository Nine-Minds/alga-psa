const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "appointment-request-cancelled-comment",
    eventName: "APPOINTMENT_REQUEST_CANCELLED",
    schemaRef: "payload.AppointmentRequestCancelled.v1"
  });
};
