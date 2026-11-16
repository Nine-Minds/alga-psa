import { afterEach, describe, expect, it } from 'vitest';
import {
  buildInboundHeaderBag,
  buildTopmostHeaderBag,
  resolveInboundHeaders,
  resolveListRewriteSender,
} from '../inboundHeaderBag';

// All addresses below use RFC 2606 reserved example domains (no real PII).
const AUTHOR_AUTH =
  'mx.example-mta.com; dkim=pass header.i=@vendor.example header.s=sel1 header.b=AbCdEf; ' +
  'spf=pass (example-mta.com: domain of jane.doe@vendor.example designates 203.0.113.10 as permitted sender) ' +
  'smtp.mailfrom=jane.doe@vendor.example; dmarc=pass (p=QUARANTINE sp=NONE dis=NONE) header.from=vendor.example';
const EVIL_AUTH = 'relay.example; dmarc=pass header.from=evil.example';

type Line = { key: string; line: string };

function listLines(authLines: string[] = [AUTHOR_AUTH]): Line[] {
  return [
    ...authLines.map((a) => ({ key: 'authentication-results', line: `Authentication-Results: ${a}` })),
    { key: 'x-beenthere', line: 'X-BeenThere: support@lists.example.com' },
    { key: 'x-original-sender', line: 'X-Original-Sender: jane.doe@vendor.example' },
    { key: 'reply-to', line: 'Reply-To: Jane Doe <jane.doe@vendor.example>' },
    { key: 'from', line: "From: 'Jane Doe' via support <support@lists.example.com>" },
  ];
}

function mapFrom(lines: Line[]): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const { key, line } of lines) {
    const value = line.slice(line.indexOf(':') + 1).trim();
    const existing = map.get(key);
    if (existing === undefined) map.set(key, value);
    else map.set(key, Array.isArray(existing) ? [...existing, value] : [existing, value]);
  }
  return map;
}

function parsedFixture(lines: Line[] = listLines()) {
  return {
    from: { value: [{ address: 'support@lists.example.com', name: "'Jane Doe' via support" }] },
    headerLines: lines,
    headers: mapFrom(lines),
  };
}

describe('buildInboundHeaderBag', () => {
  it('lower-cases names, joins repeated headers in wire order, and drops structured values', () => {
    const headers = new Map<string, unknown>([
      ['Subject', 'Hello'],
      ['Received', ['hop-1', 'hop-2']],
      ['from', { value: [{ address: 'a@example.test' }], text: 'a@example.test' }],
    ]);
    expect(buildInboundHeaderBag({ headers })).toEqual({
      subject: 'Hello',
      received: 'hop-1\nhop-2',
    });
  });

  it('strips wire x-resolved-* and x-list-* names', () => {
    const headers = new Map<string, unknown>([
      ['X-Resolved-Original-Sender', 'ceo@evil.example'],
      ['x-list-address', 'a@evil.example'],
      ['subject', 'Hi'],
    ]);
    expect(buildInboundHeaderBag({ headers })).toEqual({ subject: 'Hi' });
  });
});

describe('resolveInboundHeaders', () => {
  it('strips wire x-resolved-* before recovery and only recovery sets them', () => {
    const forged: Line[] = [
      { key: 'x-resolved-original-sender', line: 'X-Resolved-Original-Sender: ceo@evil.example' },
      { key: 'subject', line: 'Subject: hi' },
      { key: 'from', line: 'From: Bob <bob@example.test>' },
    ];
    const direct = resolveInboundHeaders({
      from: { value: [{ address: 'bob@example.test', name: 'Bob' }] },
      headerLines: forged,
      headers: mapFrom(forged),
    });
    expect(direct.listRewrite).toBeNull();
    expect(direct.headers?.subject).toBe('hi');
    expect(direct.headers).not.toHaveProperty('x-resolved-original-sender');
    expect(direct.from).toEqual({ email: 'bob@example.test', name: 'Bob' });

    const recovered = resolveInboundHeaders(
      parsedFixture([
        { key: 'x-resolved-original-sender', line: 'X-Resolved-Original-Sender: ceo@evil.example' },
        ...listLines(),
      ])
    );
    expect(recovered.listRewrite?.sender.email).toBe('jane.doe@vendor.example');
    expect(recovered.headers?.['x-resolved-original-sender']).toBe('jane.doe@vendor.example');
    expect(recovered.headers?.['x-resolved-original-sender-via']).toBe('x-original-sender');
    expect(recovered.headers?.['x-list-address']).toBe('support@lists.example.com');
    expect(recovered.from.email).toBe('jane.doe@vendor.example');
  });

  it('returns undefined headers when the message has none', () => {
    expect(resolveInboundHeaders({}).headers).toBeUndefined();
  });
});

describe('buildTopmostHeaderBag', () => {
  it('keeps only the first occurrence of a repeated header', () => {
    const bag = buildTopmostHeaderBag(parsedFixture(listLines([AUTHOR_AUTH, EVIL_AUTH])));
    expect(bag['authentication-results']).toBe(AUTHOR_AUTH);
  });
});

describe('trust boundary: list-rewrite uses the topmost Authentication-Results only', () => {
  it('does not recover when only a LOWER (attacker-stamped) A-R aligns with the claimed author', () => {
    const forgedAuthor = [
      { key: 'authentication-results', line: 'Authentication-Results: mx.example-mta.com; dmarc=fail header.from=lists.example.com' },
      { key: 'authentication-results', line: 'Authentication-Results: relay.example; dkim=pass header.d=evil.example; dmarc=pass header.from=evil.example' },
      { key: 'x-beenthere', line: 'X-BeenThere: support@lists.example.com' },
      { key: 'x-original-sender', line: 'X-Original-Sender: ceo@evil.example' },
      { key: 'from', line: "From: 'CEO' via support <support@lists.example.com>" },
    ];
    const parsed = parsedFixture(forgedAuthor);
    // Sanity: the joined downstream bag DOES contain the forged aligned block.
    expect(buildInboundHeaderBag(parsed)['authentication-results']).toContain('header.from=evil.example');

    expect(resolveListRewriteSender(parsed)).toBeNull();
    const resolved = resolveInboundHeaders(parsed);
    expect(resolved.listRewrite).toBeNull();
    expect(resolved.from.email).toBe('support@lists.example.com');
    expect(resolved.headers?.['x-resolved-original-sender']).toBeUndefined();
  });
});

describe('resolveListRewriteSender (mailparser shape + feature flag)', () => {
  const FLAG = 'INBOUND_RESOLVE_LIST_ORIGINAL_SENDER';
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('reads headerLines and recovers the original sender', () => {
    const result = resolveListRewriteSender(parsedFixture());
    expect(result?.sender.email).toBe('jane.doe@vendor.example');
    expect(result?.listAddress).toBe('support@lists.example.com');
  });

  it('returns null when the feature flag is disabled', () => {
    process.env[FLAG] = 'false';
    expect(resolveListRewriteSender(parsedFixture())).toBeNull();
  });

  it('keeps the topmost Authentication-Results when duplicated', () => {
    const result = resolveListRewriteSender(parsedFixture(listLines([AUTHOR_AUTH, EVIL_AUTH])));
    expect(result?.sender.email).toBe('jane.doe@vendor.example');
  });
});
