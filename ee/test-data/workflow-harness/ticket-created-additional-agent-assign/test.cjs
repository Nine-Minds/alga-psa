const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-created-additional-agent-assign",
    eventName: "TICKET_ADDITIONAL_AGENT_ASSIGNED",
    schemaRef: "payload.TicketAdditionalAgentAssigned.v1"
  });
};
