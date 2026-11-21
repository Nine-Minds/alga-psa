import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAllDocuments } from 'yaml';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const allowlist = 'imap.internal.example,10.40.8.12';

function render(chartPath, release, valuePath) {
  const output = execFileSync('helm', [
    'template', release, path.join(repoRoot, chartPath),
    '--set-string', `${valuePath}=${allowlist.replaceAll(',', '\\,')}`,
  ], { cwd: repoRoot, encoding: 'utf8' });
  return parseAllDocuments(output).map((document) => document.toJSON()).filter(Boolean);
}

function deploymentContainer(documents, name) {
  const deployment = documents.find((document) =>
    document.kind === 'Deployment' && document.spec?.template?.spec?.containers?.some((container) => container.name === name));
  assert.ok(deployment, `rendered Deployment for ${name} exists`);
  return deployment.spec.template.spec.containers.find((container) => container.name === name);
}

function configuredAllowlist(container) {
  return container.env?.find((entry) => entry.name === 'EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST')?.value;
}

test('on-prem Helm values reach both the application and email-service IMAP policy consumers', () => {
  const application = render('helm', 'imap-policy-app', 'imap.privateTargetAllowlist');
  const emailService = render('ee/helm/email-service', 'imap-policy-worker', 'imap.privateTargetAllowlist');

  assert.equal(configuredAllowlist(deploymentContainer(application, 'sebastian')), allowlist);
  assert.equal(configuredAllowlist(deploymentContainer(emailService, 'email-service')), allowlist);
});
