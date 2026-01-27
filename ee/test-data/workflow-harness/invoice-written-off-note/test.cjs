const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "invoice-written-off-note",
    eventName: "INVOICE_WRITTEN_OFF",
    schemaRef: "payload.InvoiceWrittenOff.v1",
    pattern: "default"
  });
};
