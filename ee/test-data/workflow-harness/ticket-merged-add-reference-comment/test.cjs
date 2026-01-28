const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-merged-add-reference-comment",
    eventName: "TICKET_MERGED",
    schemaRef: "payload.TicketMerged.v1",
    pattern: "default"
  });
};
