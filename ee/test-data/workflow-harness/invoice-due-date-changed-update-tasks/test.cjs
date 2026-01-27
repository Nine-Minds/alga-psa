const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "invoice-due-date-changed-update-tasks",
    eventName: "INVOICE_DUE_DATE_CHANGED",
    schemaRef: "payload.InvoiceDueDateChanged.v1"
  });
};
