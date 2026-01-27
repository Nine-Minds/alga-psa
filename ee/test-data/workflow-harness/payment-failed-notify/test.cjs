const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "payment-failed-notify",
    eventName: "PAYMENT_FAILED",
    schemaRef: "payload.PaymentFailed.v1",
    pattern: "default"
  });
};
