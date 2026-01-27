const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "payment-failed-email-trycatch",
    eventName: "PAYMENT_FAILED",
    schemaRef: "payload.PaymentFailed.v1",
    pattern: "tryCatch"
  });
};
