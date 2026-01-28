const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "invoice-due-date-changed-email",
    eventName: "INVOICE_DUE_DATE_CHANGED",
    schemaRef: "payload.InvoiceDueDateChanged.v1",
    pattern: "default"
  });
};
