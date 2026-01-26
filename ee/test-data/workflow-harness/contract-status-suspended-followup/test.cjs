const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "contract-status-suspended-followup",
    eventName: "CONTRACT_STATUS_CHANGED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
