const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "contract-updated-note",
    eventName: "CONTRACT_UPDATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
