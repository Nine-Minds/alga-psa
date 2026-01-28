const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "company-created-create-crm-note",
    eventName: "COMPANY_CREATED",
    schemaRef: "payload.CompanyCreated.v1"
  });
};
