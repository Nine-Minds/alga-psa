const { runNotificationFixture } = require('../_lib/notification-fixture.cjs');

module.exports = async function run(ctx) {
  return runNotificationFixture(ctx, {
    fixtureName: "time-entry-submitted-notify",
    eventName: "TIME_ENTRY_SUBMITTED",
    schemaRef: "payload.TimeEntrySubmitted.v1",
    pattern: "default"
  });
};
