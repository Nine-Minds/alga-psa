const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "company-created-onboarding-note",
    eventName: "COMPANY_CREATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
