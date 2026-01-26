async function importWorkflowBundleV1({ http, bundle, force = false }) {
  if (!http) throw new Error('importWorkflowBundleV1 requires http');
  if (!bundle) throw new Error('importWorkflowBundleV1 requires bundle');
  const qs = force ? '?force=true' : '';
  const res = await http.request(`/api/workflow-definitions/import${qs}`, {
    method: 'POST',
    json: bundle
  });
  if (!res.json) {
    throw new Error('Workflow import did not return JSON.');
  }
  return res.json;
}

async function exportWorkflowBundleV1({ http, workflowId }) {
  if (!http) throw new Error('exportWorkflowBundleV1 requires http');
  if (!workflowId) throw new Error('exportWorkflowBundleV1 requires workflowId');
  const res = await http.request(`/api/workflow-definitions/${workflowId}/export`, { method: 'GET' });
  const json = res.json;
  if (!json) {
    throw new Error('Workflow export did not return JSON.');
  }
  return json;
}

module.exports = {
  importWorkflowBundleV1,
  exportWorkflowBundleV1
};

