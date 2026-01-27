const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "company-updated-domain-change",
    eventName: "COMPANY_UPDATED",
    schemaRef: "payload.CompanyUpdated.v1",
    pattern: "default"
  });
};
