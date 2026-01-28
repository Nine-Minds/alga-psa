const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "invoice-generated-anomaly-tasks",
    eventName: "INVOICE_GENERATED",
    schemaRef: "payload.InvoiceGenerated.v1",
    pattern: "default"
  });
};
