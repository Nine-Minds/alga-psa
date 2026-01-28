const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "invoice-sent-create-followup-task",
    eventName: "INVOICE_SENT",
    schemaRef: "payload.InvoiceSent.v1"
  });
};
