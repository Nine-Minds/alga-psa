const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "invoice-overdue-attach-instructions",
    eventName: "INVOICE_OVERDUE",
    schemaRef: "payload.InvoiceOverdue.v1",
    pattern: "default"
  });
};
