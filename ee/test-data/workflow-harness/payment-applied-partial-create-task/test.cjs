const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "payment-applied-partial-create-task",
    eventName: "PAYMENT_APPLIED",
    schemaRef: "payload.PaymentApplied.v1"
  });
};
