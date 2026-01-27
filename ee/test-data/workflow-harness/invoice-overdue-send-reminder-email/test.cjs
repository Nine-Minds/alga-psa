const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "invoice-overdue-send-reminder-email",
    eventName: "INVOICE_OVERDUE",
    schemaRef: "payload.InvoiceOverdue.v1"
  });
};
