const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "payment-failed-create-task",
    eventName: "PAYMENT_FAILED",
    schemaRef: "payload.PaymentFailed.v1"
  });
};
