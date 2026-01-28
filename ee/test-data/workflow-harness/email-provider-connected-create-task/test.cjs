const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "email-provider-connected-create-task",
    eventName: "EMAIL_PROVIDER_CONNECTED",
    schemaRef: "payload.EmailProviderConnected.v1"
  });
};
