const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "ticket-comment-added-customer-notify",
    eventName: "TICKET_COMMENT_ADDED",
    schemaRef: "payload.TicketCommentAdded.v1",
    pattern: "default"
  });
};
