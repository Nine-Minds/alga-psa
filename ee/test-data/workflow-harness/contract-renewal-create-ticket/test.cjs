const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "contract-renewal-create-ticket",
    eventName: "CONTRACT_RENEWAL_UPCOMING",
    schemaRef: "payload.TicketCreated.v1"
  });
};
