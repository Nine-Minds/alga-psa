const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "invoice-finalized-email",
    eventName: "INVOICE_FINALIZED",
    schemaRef: "payload.InvoiceFinalized.v1",
    pattern: "default"
  });
};
