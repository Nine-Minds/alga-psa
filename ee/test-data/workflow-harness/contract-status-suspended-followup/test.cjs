const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "contract-status-suspended-followup",
    eventName: "CONTRACT_STATUS_CHANGED",
    schemaRef: "payload.ContractStatusChanged.v1",
    pattern: "default"
  });
};
