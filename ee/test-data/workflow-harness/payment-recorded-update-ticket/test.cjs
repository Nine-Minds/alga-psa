const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "payment-recorded-update-ticket",
    eventName: "PAYMENT_RECORDED",
    schemaRef: "payload.PaymentRecorded.v1"
  });
};
