const { runCallWorkflowFixture } = require('../_lib/callworkflow-fixture.cjs');

module.exports = async function run(ctx) {
  return runCallWorkflowFixture(ctx, {
    fixtureName: "ticket-created-call-triage-subworkflow",
    eventName: "TICKET_CREATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
