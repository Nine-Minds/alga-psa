const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-merged-add-reference-comment",
    eventName: "TICKET_MERGED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
