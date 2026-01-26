const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-sla-stage-entered-task",
    eventName: "TICKET_SLA_STAGE_ENTERED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
