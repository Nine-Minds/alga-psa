const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "appointment-request-declined-email",
    eventName: "APPOINTMENT_REQUEST_DECLINED",
    schemaRef: "payload.AppointmentRequestDeclined.v1"
  });
};
