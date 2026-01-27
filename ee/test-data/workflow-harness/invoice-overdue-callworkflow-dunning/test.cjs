const { runCallWorkflowFixture } = require('../_lib/callworkflow-fixture.cjs');

module.exports = async function run(ctx) {
  return runCallWorkflowFixture(ctx, {
    fixtureName: "invoice-overdue-callworkflow-dunning",
    eventName: "INVOICE_OVERDUE",
    schemaRef: "payload.InvoiceOverdue.v1"
  });
};
