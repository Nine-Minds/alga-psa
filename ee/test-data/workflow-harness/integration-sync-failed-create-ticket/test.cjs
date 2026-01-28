const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "integration-sync-failed-create-ticket",
    eventName: "INTEGRATION_SYNC_FAILED",
    schemaRef: "payload.IntegrationSyncFailed.v1"
  });
};
