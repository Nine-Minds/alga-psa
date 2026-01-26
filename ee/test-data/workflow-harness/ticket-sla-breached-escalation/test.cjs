const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-sla-breached-escalation",
    eventName: "TICKET_SLA_STAGE_BREACHED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
