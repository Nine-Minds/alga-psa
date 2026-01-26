const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-closed-audit-crm-note",
    eventName: "TICKET_CLOSED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
