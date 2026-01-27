const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "invoice-status-paid-close-ticket-real",
    eventName: "INVOICE_STATUS_CHANGED",
    schemaRef: "payload.InvoiceStatusChanged.v1"
  });
};
