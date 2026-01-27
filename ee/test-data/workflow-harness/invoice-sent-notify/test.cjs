const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "invoice-sent-notify",
    eventName: "INVOICE_SENT",
    schemaRef: "payload.InvoiceSent.v1",
    pattern: "default"
  });
};
