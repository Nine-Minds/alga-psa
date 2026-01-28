const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "invoice-generated-verify-update",
    eventName: "INVOICE_GENERATED",
    schemaRef: "payload.InvoiceGenerated.v1"
  });
};
