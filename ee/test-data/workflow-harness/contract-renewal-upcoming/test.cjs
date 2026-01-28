const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "contract-renewal-upcoming",
    eventName: "CONTRACT_RENEWAL_UPCOMING",
    schemaRef: "payload.ContractRenewalUpcoming.v1",
    pattern: "default"
  });
};
