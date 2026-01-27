const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "contract-renewal-create-ticket-real",
    eventName: "CONTRACT_RENEWAL_UPCOMING",
    schemaRef: "payload.ContractRenewalUpcoming.v1"
  });
};
