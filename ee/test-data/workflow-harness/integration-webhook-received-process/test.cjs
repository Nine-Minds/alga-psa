const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "integration-webhook-received-process",
    eventName: "INTEGRATION_WEBHOOK_RECEIVED",
    schemaRef: "payload.IntegrationWebhookReceived.v1"
  });
};
