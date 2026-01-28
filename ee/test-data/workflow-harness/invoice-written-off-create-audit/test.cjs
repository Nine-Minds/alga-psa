const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "invoice-written-off-create-audit",
    eventName: "INVOICE_WRITTEN_OFF",
    schemaRef: "payload.InvoiceWrittenOff.v1"
  });
};
