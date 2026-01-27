const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-sla-breached-escalation",
    eventName: "TICKET_SLA_STAGE_BREACHED",
    schemaRef: "payload.TicketSlaStageBreached.v1",
    pattern: "default"
  });
};
