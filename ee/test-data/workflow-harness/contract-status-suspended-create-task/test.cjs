const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "contract-status-suspended-create-task",
    eventName: "CONTRACT_STATUS_CHANGED",
    schemaRef: "payload.ContractStatusChanged.v1"
  });
};
