import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadAll, dump } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
const chartPath = path.join(repositoryRoot, 'ee/helm/workflow-worker');
const applianceValuesPath = path.join(
  repositoryRoot,
  'ee/appliance/flux/profiles/single-node/values/workflow-worker.single-node.yaml'
);
const helmPath = process.env.HELM_BIN || 'helm';

function renderEnv(values?: Record<string, unknown>, extraArgs: string[] = []): Array<Record<string, any>> {
  const args = ['template', 'workflow-worker', chartPath, ...extraArgs];
  const rendered = execFileSync(helmPath, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    // `-f -` reads values from stdin
    input: values ? dump(values) : undefined,
  });
  const deployment = loadAll(rendered).find((d: any) => d?.kind === 'Deployment') as Record<string, any>;
  return deployment.spec.template.spec.containers[0].env;
}

const render = (values?: Record<string, unknown>) => renderEnv(values, values ? ['-f', '-'] : []);
const emailVars = (env: Array<Record<string, any>>) =>
  env.filter((e) => /^(EMAIL_|RESEND_)/.test(e.name));

describe('workflow-worker system email Helm rendering', () => {
  it('renders no EMAIL_* or RESEND_* variables with defaults', () => {
    expect(emailVars(render())).toEqual([]);
  });

  it('renders no email variables for the appliance profile (no system email source to mirror)', () => {
    expect(emailVars(renderEnv(undefined, ['--values', applianceValuesPath]))).toEqual([]);
  });

  it('renders provider, from and a secretKeyRef RESEND_API_KEY when the block is populated', () => {
    const env = emailVars(
      render({
        email: {
          provider: 'resend',
          from: 'noreply@example.com',
          resendApiKeySecret: { name: 'resend-credentials', key: 'RESEND_API_KEY' },
        },
      })
    );
    expect(env).toEqual([
      { name: 'EMAIL_PROVIDER_TYPE', value: 'resend' },
      { name: 'EMAIL_FROM', value: 'noreply@example.com' },
      {
        name: 'RESEND_API_KEY',
        valueFrom: { secretKeyRef: { name: 'resend-credentials', key: 'RESEND_API_KEY', optional: true } },
      },
    ]);
  });

  it('renders SMTP settings with the password as a secretKeyRef', () => {
    const env = emailVars(
      render({
        email: {
          smtp: { host: 'smtp.example.com', port: '587', username: 'u', passwordSecret: { name: 'smtp', key: 'pw' } },
        },
      })
    );
    expect(env.map((e) => e.name)).toEqual(['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USERNAME', 'EMAIL_PASSWORD']);
    expect(env[3].valueFrom.secretKeyRef).toEqual({ name: 'smtp', key: 'pw', optional: true });
  });

  it('renders EMAIL_ENABLE="false" only when email.enabled is false', () => {
    expect(emailVars(render({ email: { enabled: false } }))).toEqual([{ name: 'EMAIL_ENABLE', value: 'false' }]);
    expect(emailVars(render({ email: { enabled: true } }))).toEqual([]);
  });

  it('renders extraEnv entries intact, including valueFrom', () => {
    const env = render({
      extraEnv: [
        { name: 'PLAIN', value: 'x' },
        { name: 'FROM_SECRET', valueFrom: { secretKeyRef: { name: 's', key: 'k' } } },
      ],
    });
    expect(env.find((e) => e.name === 'PLAIN')).toEqual({ name: 'PLAIN', value: 'x' });
    expect(env.find((e) => e.name === 'FROM_SECRET')).toEqual({
      name: 'FROM_SECRET',
      valueFrom: { secretKeyRef: { name: 's', key: 'k' } },
    });
  });

  it('renders numeric and boolean extraEnv values as quoted strings', () => {
    const out = render({
      extraEnv: [
        { name: 'A', value: 5 },
        { name: 'B', value: true },
        { name: 'C' },
        { name: 'D', value: false },
        { name: 'E', value: 0 },
      ],
    });
    expect(out.find((e) => e.name === 'A')).toEqual({ name: 'A', value: '5' });
    expect(out.find((e) => e.name === 'B')).toEqual({ name: 'B', value: 'true' });
    // value-less entry must render "" (not "<nil>"); false/0 must not be blanked (no `default ""`)
    expect(out.find((e) => e.name === 'C')).toEqual({ name: 'C', value: '' });
    expect(out.find((e) => e.name === 'D')).toEqual({ name: 'D', value: 'false' });
    expect(out.find((e) => e.name === 'E')).toEqual({ name: 'E', value: '0' });
  });
});
