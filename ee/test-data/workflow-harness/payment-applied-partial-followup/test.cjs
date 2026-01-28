const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "payment-applied-partial-followup",
    eventName: "PAYMENT_APPLIED",
    schemaRef: "payload.PaymentApplied.v1",
    pattern: "default"
  });
};
