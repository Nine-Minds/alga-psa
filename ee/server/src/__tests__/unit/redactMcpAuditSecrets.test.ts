import { describe, it, expect } from 'vitest';
import { planRowRemediation } from '../../../scripts/redactMcpAuditSecretsLogic';

const S = 'whsec_Leaked999';

describe('planRowRemediation', () => {
  it('re-redacts a parseable summary, keeping status/ok', () => {
    const patch = planRowRemediation({
      tool: 'call_api_endpoint',
      result_summary: JSON.stringify({ status: 200, ok: true, data: { signing_secret: S } }),
      arguments: null,
    })!;
    expect(patch.result_summary).not.toContain(S);
    expect(JSON.parse(patch.result_summary!).status).toBe(200);
  });

  it('nulls a truncated (unparseable) summary that still shows a secret key', () => {
    const patch = planRowRemediation({
      tool: 'call_api_endpoint',
      result_summary: `{"status":200,"data":{"signing_secret":"${S}","pad":"xxxx`,
      arguments: null,
    })!;
    expect(patch.result_summary).toBeNull();
  });

  it('leaves clean rows alone and is idempotent', () => {
    expect(planRowRemediation({ tool: 't', result_summary: '{"status":200,"ok":true}', arguments: { id: 1 } })).toBeNull();
    const first = planRowRemediation({ tool: 't', result_summary: `{"signing_secret":"${S}"}`, arguments: { body: { client_secret: S } } })!;
    expect(first.arguments).not.toContain(S);
    expect(
      planRowRemediation({ tool: 't', result_summary: first.result_summary!, arguments: JSON.parse(first.arguments!) }),
    ).toBeNull();
  });
});
