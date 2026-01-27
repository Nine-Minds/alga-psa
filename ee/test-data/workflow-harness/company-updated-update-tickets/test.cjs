const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "company-updated-update-tickets",
    eventName: "COMPANY_UPDATED",
    schemaRef: "payload.CompanyUpdated.v1"
  });
};
