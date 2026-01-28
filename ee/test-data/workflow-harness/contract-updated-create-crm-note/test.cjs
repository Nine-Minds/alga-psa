const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "contract-updated-create-crm-note",
    eventName: "CONTRACT_UPDATED",
    schemaRef: "payload.ContractUpdated.v1"
  });
};
