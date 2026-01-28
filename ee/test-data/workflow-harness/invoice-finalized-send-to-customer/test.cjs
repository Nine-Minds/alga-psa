const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "invoice-finalized-send-to-customer",
    eventName: "INVOICE_FINALIZED",
    schemaRef: "payload.InvoiceFinalized.v1"
  });
};
