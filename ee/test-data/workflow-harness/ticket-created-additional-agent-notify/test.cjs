const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "ticket-created-additional-agent-notify",
    eventName: "TICKET_ADDITIONAL_AGENT_ASSIGNED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
