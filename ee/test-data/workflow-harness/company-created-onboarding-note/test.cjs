const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "company-created-onboarding-note",
    eventName: "COMPANY_CREATED",
    schemaRef: "payload.CompanyCreated.v1",
    pattern: "default"
  });
};
