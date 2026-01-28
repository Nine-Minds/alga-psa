const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-sla-stage-entered-task",
    eventName: "TICKET_SLA_STAGE_ENTERED",
    schemaRef: "payload.TicketSlaStageEntered.v1",
    pattern: "default"
  });
};
