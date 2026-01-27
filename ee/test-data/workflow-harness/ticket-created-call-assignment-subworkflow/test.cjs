const { runCallWorkflowBizFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runCallWorkflowBizFixture(ctx, {
    fixtureName: "ticket-created-call-assignment-subworkflow",
    eventName: "TICKET_CREATED",
    schemaRef: "payload.TicketCreated.v1",
    kind: "ticket_comment"
  });
};
