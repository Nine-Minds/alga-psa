const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "invoice-status-multi-branch",
    eventName: "INVOICE_STATUS_CHANGED",
    schemaRef: "payload.InvoiceStatusChanged.v1",
    pattern: "multiBranch"
  });
};
