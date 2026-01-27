const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "appointment-request-created-task",
    eventName: "APPOINTMENT_REQUEST_CREATED",
    schemaRef: "payload.AppointmentRequestCreated.v1"
  });
};
