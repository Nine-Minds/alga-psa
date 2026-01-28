const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-created-additional-agent-notify",
    eventName: "TICKET_ADDITIONAL_AGENT_ASSIGNED",
    schemaRef: "payload.TicketAdditionalAgentAssigned.v1",
    pattern: "default"
  });
};
