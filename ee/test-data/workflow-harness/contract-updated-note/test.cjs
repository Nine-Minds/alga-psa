const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "contract-updated-note",
    eventName: "CONTRACT_UPDATED",
    schemaRef: "payload.ContractUpdated.v1",
    pattern: "default"
  });
};
