import { afterEach, describe, expect, it } from 'vitest';
import {
  computeListRewriteCandidate,
  resolveListRewriteCandidate,
  type HeaderBag,
} from '../listRewriteSender';

// All addresses below use RFC 2606 reserved example domains (no real PII).
const AUTHOR_AUTH =
  'mx.example-mta.com; dkim=pass header.i=@vendor.example header.s=sel1 header.b=AbCdEf; ' +
  'spf=pass (example-mta.com: domain of jane.doe@vendor.example designates 203.0.113.10 as permitted sender) ' +
  'smtp.mailfrom=jane.doe@vendor.example; dmarc=pass (p=QUARANTINE sp=NONE dis=NONE) header.from=vendor.example';

function groupHeaders(overrides: Partial<HeaderBag> = {}): HeaderBag {
  return {
    'x-beenthere': 'support@lists.example.com',
    'list-id': '<support.lists.example.com>',
    'x-original-sender': 'jane.doe@vendor.example',
    'reply-to': 'Jane Doe <jane.doe@vendor.example>',
    'authentication-results': AUTHOR_AUTH,
    ...overrides,
  };
}

describe('computeListRewriteCandidate', () => {
  it('recovers the original sender from a mailing-list DMARC rewrite', () => {
    const result = computeListRewriteCandidate(groupHeaders(), {
      email: 'support@lists.example.com',
      name: "'Jane Doe' via support",
    });

    expect(result).toEqual({
      sender: { email: 'jane.doe@vendor.example', name: undefined },
      listAddress: 'support@lists.example.com',
      via: 'x-original-sender',
    });
  });

  it('prefers X-Original-From over X-Original-Sender and Reply-To', () => {
    const result = computeListRewriteCandidate(
      groupHeaders({ 'x-original-from': 'jane.doe@vendor.example' }),
      { email: 'support@lists.example.com' }
    );
    expect(result?.via).toBe('x-original-from');
    expect(result?.sender.email).toBe('jane.doe@vendor.example');
  });

  it('falls back to Reply-To when no X-Original-* header is present', () => {
    const headers = groupHeaders();
    delete headers['x-original-sender'];
    const result = computeListRewriteCandidate(headers, { email: 'support@lists.example.com' });
    expect(result?.via).toBe('reply-to');
    expect(result?.sender.email).toBe('jane.doe@vendor.example');
  });

  it('returns null for ordinary direct mail (no list markers)', () => {
    const result = computeListRewriteCandidate(
      { 'authentication-results': AUTHOR_AUTH },
      { email: 'jane.doe@vendor.example' }
    );
    expect(result).toBeNull();
  });

  it('returns null for preserved-From list mail the relay did not record an author for', () => {
    // Normal list mail that keeps the author in From but carries no
    // X-Original-* header; nothing vouches that the relay saw this author.
    const headers = groupHeaders();
    delete headers['x-original-sender'];
    const result = computeListRewriteCandidate(headers, {
      email: 'jane.doe@vendor.example',
    });
    expect(result).toBeNull();
  });

  it('returns a candidate even when raw auth claims do not align; authorization is checked elsewhere', () => {
    const headers = groupHeaders({
      'x-original-sender': 'attacker@evil.example',
      'reply-to': 'attacker@evil.example',
    });
    const result = computeListRewriteCandidate(headers, { email: 'support@lists.example.com' });
    expect(result?.sender.email).toBe('attacker@evil.example');
  });

  it('returns the candidate without Authentication-Results', () => {
    const headers = groupHeaders();
    delete headers['authentication-results'];
    const result = computeListRewriteCandidate(headers, { email: 'support@lists.example.com' });
    expect(result?.sender.email).toBe('jane.doe@vendor.example');
  });

  it('extracts the reported victim only as a candidate from forged list and auth headers', () => {
    const headers: HeaderBag = {
      'x-beenthere': 'relay@attacker.test',
      'list-id': '<relay.attacker.test>',
      'x-original-from': 'victim@customer.test',
      'authentication-results': 'attacker; dmarc=pass header.from=customer.test',
      'arc-authentication-results': 'i=1; attacker; dkim=pass header.d=customer.test',
    };
    const result = computeListRewriteCandidate(headers, { email: 'relay@attacker.test' });
    expect(result).toMatchObject({
      sender: { email: 'victim@customer.test' },
      listAddress: 'relay@attacker.test',
      via: 'x-original-from',
    });
  });

  it('treats a spam relay X-Original-Sender as a candidate, never as authorization', () => {
    const headers: HeaderBag = {
      'x-beenthere': 'list@spam.example',
      'list-id': '<bulk.spam.example>',
      'x-original-sender': 'support@bank.example',
      'authentication-results': 'mx.example-mta.com; dkim=none; spf=softfail; dmarc=fail header.from=spam.example',
    };
    const result = computeListRewriteCandidate(headers, { email: 'list@spam.example' });
    expect(result?.sender.email).toBe('support@bank.example');
  });

  it('does not depend on raw auth alignment claims for candidate extraction', () => {
    const headers = groupHeaders({
      'x-original-sender': 'user@mail.vendor.example',
      'reply-to': 'user@mail.vendor.example',
    });
    const result = computeListRewriteCandidate(headers, { email: 'support@lists.example.com' });
    expect(result?.sender.email).toBe('user@mail.vendor.example');
  });
});

describe('computeListRewriteCandidate (preserved-From relay)', () => {
  // Google Groups may retain the author's From while the final relay signs the
  // message with its own domain. The headers below remain claims, not evidence.
  const RELAY_AUTH =
    'mx.example-mta.com; dkim=pass header.i=@lists-example-com.gappssmtp.example header.s=sel1 header.b=ZzYyXx; ' +
    'arc=pass (i=3 spf=pass spfdomain=vendor.example dkim=pass dkdomain=vendor.example); ' +
    'spf=pass (example-mta.com: domain of support+bounce@lists.example.com designates 203.0.113.20 as permitted sender) ' +
    'smtp.mailfrom=support+bounce@lists.example.com; dara=fail header.i=@lists.example.com';

  function preservedHeaders(overrides: Partial<HeaderBag> = {}): HeaderBag {
    return {
      'list-id': '<support.lists.example.com>',
      'mailing-list': 'list support@lists.example.com; contact support+owners@lists.example.com',
      'precedence': 'list',
      'x-original-sender': 'jane.doe@vendor.example',
      'authentication-results': RELAY_AUTH,
      ...overrides,
    };
  }

  it('resolves the preserved author when the relay recorded them and the MX vouches via ARC', () => {
    const result = computeListRewriteCandidate(preservedHeaders({ sender: 'support@lists.example.com' }), {
      email: 'jane.doe@vendor.example',
      name: 'Jane Doe',
    });
    expect(result).toEqual({
      sender: { email: 'jane.doe@vendor.example', name: 'Jane Doe' },
      listAddress: 'support@lists.example.com',
      via: 'preserved-from',
    });
  });

  it('accepts X-Original-From as the relay record', () => {
    const headers = preservedHeaders({ sender: 'support@lists.example.com', 'x-original-from': 'Jane Doe <jane.doe@vendor.example>' });
    delete headers['x-original-sender'];
    const result = computeListRewriteCandidate(headers, { email: 'jane.doe@vendor.example' });
    expect(result?.via).toBe('preserved-from');
  });

  it('returns null when the recorded author differs from From', () => {
    const result = computeListRewriteCandidate(
      preservedHeaders({ sender: 'support@lists.example.com', 'x-original-sender': 'someone.else@vendor.example' }),
      { email: 'jane.doe@vendor.example' }
    );
    expect(result).toBeNull();
  });

  it('keeps a matching preserved From candidate without trusting Authentication-Results', () => {
    const headers = preservedHeaders({
      sender: 'support@lists.example.com',
      'x-original-sender': 'ceo@bank.example',
      'authentication-results': RELAY_AUTH,
    });
    const result = computeListRewriteCandidate(headers, { email: 'ceo@bank.example' });
    expect(result).toMatchObject({ sender: { email: 'ceo@bank.example' }, via: 'preserved-from' });
  });

  it('returns null without a list address to attribute the relay to', () => {
    const headers = preservedHeaders();
    delete headers['mailing-list'];
    // list-id alone flags list mail but yields no address; no Sender/List-Post either.
    const result = computeListRewriteCandidate(headers, { email: 'jane.doe@vendor.example' });
    expect(result).toBeNull();
  });
});

describe('resolveListRewriteCandidate (mailparser shape + feature flag)', () => {
  const FLAG = 'INBOUND_RESOLVE_LIST_ORIGINAL_SENDER';
  afterEach(() => {
    delete process.env[FLAG];
  });

  function parsedFixture() {
    return {
      from: { value: [{ address: 'support@lists.example.com', name: "'Jane Doe' via support" }] },
      headerLines: [
        { key: 'authentication-results', line: `Authentication-Results: ${AUTHOR_AUTH}` },
        { key: 'x-beenthere', line: 'X-BeenThere: support@lists.example.com' },
        { key: 'x-original-sender', line: 'X-Original-Sender: jane.doe@vendor.example' },
        { key: 'reply-to', line: 'Reply-To: Jane Doe <jane.doe@vendor.example>' },
        { key: 'from', line: "From: 'Jane Doe' via support <support@lists.example.com>" },
      ],
    };
  }

  it('reads headerLines and recovers the original sender', () => {
    const result = resolveListRewriteCandidate(parsedFixture());
    expect(result?.sender.email).toBe('jane.doe@vendor.example');
    expect(result?.listAddress).toBe('support@lists.example.com');
  });

  it('returns null when the feature flag is disabled', () => {
    process.env[FLAG] = 'false';
    expect(resolveListRewriteCandidate(parsedFixture())).toBeNull();
  });

  it('ignores forged or duplicate Authentication-Results while extracting a candidate', () => {
    const fixture = parsedFixture();
    // A later success claim has no authority either.
    fixture.headerLines.push({
      key: 'authentication-results',
      line: 'Authentication-Results: relay.example; dmarc=pass header.from=evil.example',
    });
    const result = resolveListRewriteCandidate(fixture);
    expect(result?.sender.email).toBe('jane.doe@vendor.example');
  });
});
