const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "appointment-request-approved-create",
    eventName: "APPOINTMENT_REQUEST_APPROVED",
    schemaRef: "payload.AppointmentRequestApproved.v1"
  });
};
