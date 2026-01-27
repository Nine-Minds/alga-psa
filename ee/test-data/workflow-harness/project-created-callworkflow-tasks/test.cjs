const { runCallWorkflowFixture } = require('../_lib/callworkflow-fixture.cjs');

module.exports = async function run(ctx) {
  return runCallWorkflowFixture(ctx, {
    fixtureName: "project-created-callworkflow-tasks",
    eventName: "PROJECT_CREATED",
    schemaRef: "payload.ProjectCreated.v1"
  });
};
