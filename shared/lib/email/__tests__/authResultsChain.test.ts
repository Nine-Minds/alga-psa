import { describe, expect, it } from 'vitest';
import {
  evaluateContactAttribution,
  normalizeInboundAuthTrust,
  parseArcAuthenticationResults,
  parseAuthenticationResults,
  type ArcSealVerdict,
  type InboundAuthTrustPolicy,
} from '../authResultsChain';
import { allowsInternalSenderAttribution, verifySenderAuthentication } from '../senderAuthVerification';
import { verifyArcSeal } from '../../../services/email/inboundAuthTrust';
import {
  AVANAN_ARC_RESULTS,
  FROM_ADDRESS,
  MS_TOP_BLOCK,
  AVANAN_LOWER_BLOCK,
  buildGatewayMessage,
  mockDkimResolver,
} from './gatewayFixtures';

const ARC_PASS: ArcSealVerdict = { cv: 'pass', sealingAuthservId: 'mx.avanan.net' };
const gatewayPolicy = (mode: InboundAuthTrustPolicy['mode'], ids = ['mx.avanan.net']): InboundAuthTrustPolicy => ({
  mode,
  trustedAuthservIds: ids,
});

async function evaluate(
  options: Parameters<typeof buildGatewayMessage>[0],
  policy: InboundAuthTrustPolicy | null,
  arcSeal?: ArcSealVerdict | null
) {
  const { headers, rawMime } = await buildGatewayMessage(options);
  const seal = arcSeal === undefined
    ? await verifyArcSeal(rawMime, { resolver: mockDkimResolver() })
    : arcSeal;
  return evaluateContactAttribution({
    blocks: parseAuthenticationResults(headers['authentication-results'], FROM_ADDRESS),
    arcSets: parseArcAuthenticationResults(
      { authenticationResults: headers['arc-authentication-results'], seal: headers['arc-seal'] },
      FROM_ADDRESS
    ),
    arcSeal: seal,
    policy,
  });
}

describe('parseAuthenticationResults', () => {
  it('returns every block in header order with its authserv-id and per-block alignment', () => {
    const blocks = parseAuthenticationResults([MS_TOP_BLOCK, AVANAN_LOWER_BLOCK], FROM_ADDRESS);
    expect(blocks.map((b) => b.authservId)).toEqual([null, 'mx.avanan.net']);
    expect(blocks[0].results?.aligned).toEqual({ spf: false, dkim: false, dmarc: false });
    expect(blocks[1].results?.aligned.spf).toBe(true);
  });

  it('never takes a block\'s header.from claim on its own: alignment is against the real From domain', () => {
    const [block] = parseAuthenticationResults('mx.evil.test; dmarc=pass header.from=domotz.com', 'phill@other.example');
    expect(block.results?.aligned.dmarc).toBe(false);
  });

  it('keeps verifySenderAuthentication on first-block semantics', () => {
    const joined = `${MS_TOP_BLOCK}\n${AVANAN_LOWER_BLOCK}`;
    const first = verifySenderAuthentication(joined, FROM_ADDRESS);
    expect(first).toEqual(parseAuthenticationResults(joined, FROM_ADDRESS)[0].results);
    expect(first?.spf).toBe('pass');
    expect(first?.aligned.spf).toBe(false);
    expect(allowsInternalSenderAttribution(first)).toBe(false);
  });

  it('reads the block\'s own arc verdict outside comments only', () => {
    const [withArc] = parseAuthenticationResults('mx.ms; arc=pass (i=1 spf=pass); spf=none', FROM_ADDRESS);
    expect(withArc.arc).toBe('pass');
    const [commentOnly] = parseAuthenticationResults('mx.ms; spf=none (note arc=pass)', FROM_ADDRESS);
    expect(commentOnly.arc).toBeNull();
  });
});

describe('parseArcAuthenticationResults', () => {
  it('orders sets by i=, strips comments, and pairs each with its seal domain', () => {
    const sets = parseArcAuthenticationResults({
      authenticationResults: [
        'i=2; mx.microsoft.com 1; spf=pass (i=1 dkim=pass header.d=domotz.com) smtp.mailfrom=other.test',
        `i=1; ${AVANAN_ARC_RESULTS}`,
      ],
      seal: ['i=2; a=rsa-sha256; cv=pass; d=microsoft.com; s=arcselector', 'i=1; a=rsa-sha256; cv=none; d=avanan.net; s=sel'],
    }, FROM_ADDRESS);
    expect(sets.map((s) => [s.instance, s.authservId, s.sealDomain])).toEqual([
      [1, 'mx.avanan.net', 'avanan.net'],
      [2, 'mx.microsoft.com', 'microsoft.com'],
    ]);
    expect(sets[0].results?.aligned).toMatchObject({ spf: true, dkim: true });
    expect(sets[1].results?.aligned.dkim).toBe(false);
  });
});

describe('normalizeInboundAuthTrust', () => {
  it('defaults to off and lower-cases/dedupes ids', () => {
    expect(normalizeInboundAuthTrust(undefined)).toEqual({ mode: 'off', trustedAuthservIds: [] });
    expect(normalizeInboundAuthTrust({ mode: 'bogus' }).mode).toBe('off');
    expect(normalizeInboundAuthTrust('{"mode":"arc-sealed","trustedAuthservIds":["MX.Avanan.net","mx.avanan.net"," "]}'))
      .toEqual({ mode: 'arc-sealed', trustedAuthservIds: ['mx.avanan.net'] });
  });
});

describe('evaluateContactAttribution (Phill\'s gateway sample)', () => {
  it('mode off: the match is still dropped (regression)', async () => {
    const decision = await evaluate({}, gatewayPolicy('off'));
    expect(decision).toMatchObject({ trusted: false, source: 'none' });
    expect((await evaluate({}, null)).trusted).toBe(false);
  });

  it('arc-sealed with a trusted authserv-id and a really verified seal: kept as gateway-arc', async () => {
    const { rawMime } = await buildGatewayMessage();
    const seal = await verifyArcSeal(rawMime, { resolver: mockDkimResolver() });
    expect(seal).toEqual({ cv: 'pass', sealingAuthservId: 'mx.avanan.net' });
    const decision = await evaluate({}, gatewayPolicy('arc-sealed'));
    expect(decision).toMatchObject({ trusted: true, source: 'gateway-arc' });
  });

  it('arc-sealed with a tampered message: seal fails, dropped', async () => {
    const { rawMime } = await buildGatewayMessage({ tamperAfterSeal: true });
    expect((await verifyArcSeal(rawMime, { resolver: mockDkimResolver() })).cv).toBe('fail');
    expect((await evaluate({ tamperAfterSeal: true }, gatewayPolicy('arc-sealed'))).trusted).toBe(false);
  });

  it('arc-sealed with an unresolvable signing key: dropped', async () => {
    const { rawMime } = await buildGatewayMessage();
    const seal = await verifyArcSeal(rawMime, { resolver: mockDkimResolver(['someone-else.example']) });
    expect(seal.cv).not.toBe('pass');
    expect((await evaluate({}, gatewayPolicy('arc-sealed'), seal)).trusted).toBe(false);
  });

  it('arc-sealed with no ARC at all: a forged lower block is dropped even with the gateway configured', async () => {
    const { rawMime } = await buildGatewayMessage({ seal: false });
    expect((await verifyArcSeal(rawMime, { resolver: mockDkimResolver() })).cv).toBe('none');
    const decision = await evaluate({ seal: false }, gatewayPolicy('arc-sealed'));
    expect(decision).toMatchObject({ trusted: false, source: 'none' });
  });

  it('arc-sealed: a trusted authserv-id whose pass is not aligned with From is dropped', async () => {
    const decision = await evaluate(
      { arcAuthResults: 'mx.avanan.net; spf=pass smtp.mailfrom=attacker.test; dkim=pass header.d=attacker.test' },
      gatewayPolicy('arc-sealed')
    );
    expect(decision.trusted).toBe(false);
  });

  it('arc-sealed: an attacker\'s own valid seal naming the trusted authserv-id is not bound to it', async () => {
    const { rawMime } = await buildGatewayMessage({ signingDomain: 'attacker.test' });
    const seal = await verifyArcSeal(rawMime, { resolver: mockDkimResolver(['attacker.test']) });
    expect(seal.cv).toBe('pass');
    const decision = await evaluate({ signingDomain: 'attacker.test' }, gatewayPolicy('arc-sealed'), seal);
    expect(decision.trusted).toBe(false);
  });

  it('arc-sealed: an authserv-id that is not trusted is dropped', async () => {
    expect((await evaluate({}, gatewayPolicy('arc-sealed', ['mx.other.example']))).trusted).toBe(false);
    expect((await evaluate({}, gatewayPolicy('arc-sealed', []))).trusted).toBe(false);
  });

  it('a bare lower block is never enough, whatever the mode', async () => {
    for (const mode of ['off', 'arc-sealed', 'mta-arc-pass'] as const) {
      const decision = await evaluate({ seal: false }, gatewayPolicy(mode), { cv: 'pass', sealingAuthservId: 'mx.avanan.net' });
      expect(decision.trusted).toBe(false);
    }
  });

  it('mta-arc-pass: top block with arc=pass is kept; without it, dropped', async () => {
    const withArc = await evaluate(
      { topBlock: `${MS_TOP_BLOCK}; arc=pass (i=1 spf=pass dkim=pass)` },
      gatewayPolicy('mta-arc-pass')
    );
    expect(withArc).toMatchObject({ trusted: true, source: 'mta-arc-pass' });
    expect((await evaluate({}, gatewayPolicy('mta-arc-pass'))).trusted).toBe(false);
  });

  it('mta-arc-pass still requires a trusted, bound, aligned ARC set (an arc=pass alone is not enough)', async () => {
    const decision = await evaluate(
      { topBlock: `${MS_TOP_BLOCK}; arc=pass`, signingDomain: 'attacker.test' },
      gatewayPolicy('mta-arc-pass')
    );
    expect(decision.trusted).toBe(false);
  });

  it('the receiving MTA\'s own aligned pass is source mta regardless of policy', () => {
    const decision = evaluateContactAttribution({
      blocks: parseAuthenticationResults('mx.ms; spf=pass smtp.mailfrom=domotz.com', FROM_ADDRESS),
      arcSets: [],
      policy: null,
    });
    expect(decision).toMatchObject({ trusted: true, source: 'mta' });
  });

  it('never confers an internal identity: internal attribution still reads only the first block', async () => {
    const { headers } = await buildGatewayMessage();
    const first = verifySenderAuthentication(headers['authentication-results'], FROM_ADDRESS);
    expect(allowsInternalSenderAttribution(first)).toBe(false);
  });
});
