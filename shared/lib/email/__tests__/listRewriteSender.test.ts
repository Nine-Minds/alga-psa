import { afterEach, describe, expect, it } from 'vitest';
import {
  computeListRewriteSender,
  resolveListRewriteSender,
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

describe('computeListRewriteSender', () => {
  it('recovers the original sender from a mailing-list DMARC rewrite', () => {
    const result = computeListRewriteSender(groupHeaders(), {
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
    const result = computeListRewriteSender(
      groupHeaders({ 'x-original-from': 'jane.doe@vendor.example' }),
      { email: 'support@lists.example.com' }
    );
    expect(result?.via).toBe('x-original-from');
    expect(result?.sender.email).toBe('jane.doe@vendor.example');
  });

  it('falls back to Reply-To when no X-Original-* header is present', () => {
    const headers = groupHeaders();
    delete headers['x-original-sender'];
    const result = computeListRewriteSender(headers, { email: 'support@lists.example.com' });
    expect(result?.via).toBe('reply-to');
    expect(result?.sender.email).toBe('jane.doe@vendor.example');
  });

  it('returns null for ordinary direct mail (no list markers)', () => {
    const result = computeListRewriteSender(
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
    const result = computeListRewriteSender(headers, {
      email: 'jane.doe@vendor.example',
    });
    expect(result).toBeNull();
  });

  it('returns null when the recovered sender is not DKIM/DMARC/SPF aligned (anti-spoof)', () => {
    const headers = groupHeaders({
      'x-original-sender': 'attacker@evil.example',
      'reply-to': 'attacker@evil.example',
    });
    // Auth results still only vouch for vendor.example, not evil.example.
    const result = computeListRewriteSender(headers, { email: 'support@lists.example.com' });
    expect(result).toBeNull();
  });

  it('returns null when no Authentication-Results header is available', () => {
    const headers = groupHeaders();
    delete headers['authentication-results'];
    const result = computeListRewriteSender(headers, { email: 'support@lists.example.com' });
    expect(result).toBeNull();
  });

  it('excludes spam relays whose recovered sender fails auth alignment', () => {
    // Mirrors the observed spam pattern: From rewritten to a junk list domain,
    // X-Original-Sender claims a brand, but auth does not vouch for it.
    const headers: HeaderBag = {
      'x-beenthere': 'list@spam.example',
      'list-id': '<bulk.spam.example>',
      'x-original-sender': 'support@bank.example',
      'authentication-results': 'mx.example-mta.com; dkim=none; spf=softfail; dmarc=fail header.from=spam.example',
    };
    const result = computeListRewriteSender(headers, { email: 'list@spam.example' });
    expect(result).toBeNull();
  });

  it('accepts subdomain-aligned auth domains', () => {
    const headers = groupHeaders({
      'x-original-sender': 'user@mail.vendor.example',
      'reply-to': 'user@mail.vendor.example',
    });
    const result = computeListRewriteSender(headers, { email: 'support@lists.example.com' });
    expect(result?.sender.email).toBe('user@mail.vendor.example');
  });
});

describe('computeListRewriteSender (preserved-From relay)', () => {
  // Google Groups delivering mail from an author whose domain does not enforce
  // DMARC: From is kept, but the final MX's SPF/DKIM verdicts belong to the
  // relay (bounce address + re-signature). Only the arc=pass annotation and the
  // earlier ARC block vouch for the author domain.
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
    const result = computeListRewriteSender(preservedHeaders({ sender: 'support@lists.example.com' }), {
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
    const result = computeListRewriteSender(headers, { email: 'jane.doe@vendor.example' });
    expect(result?.via).toBe('preserved-from');
  });

  it('returns null when the recorded author differs from From', () => {
    const result = computeListRewriteSender(
      preservedHeaders({ sender: 'support@lists.example.com', 'x-original-sender': 'someone.else@vendor.example' }),
      { email: 'jane.doe@vendor.example' }
    );
    expect(result).toBeNull();
  });

  it('returns null when nothing in Authentication-Results vouches for the From domain (anti-spoof)', () => {
    const headers = preservedHeaders({
      sender: 'support@lists.example.com',
      'x-original-sender': 'ceo@bank.example',
      'authentication-results': RELAY_AUTH,
    });
    const result = computeListRewriteSender(headers, { email: 'ceo@bank.example' });
    expect(result).toBeNull();
  });

  it('returns null without a list address to attribute the relay to', () => {
    const headers = preservedHeaders();
    delete headers['mailing-list'];
    // list-id alone flags list mail but yields no address; no Sender/List-Post either.
    const result = computeListRewriteSender(headers, { email: 'jane.doe@vendor.example' });
    expect(result).toBeNull();
  });
});

describe('resolveListRewriteSender (mailparser shape + feature flag)', () => {
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
    const result = resolveListRewriteSender(parsedFixture());
    expect(result?.sender.email).toBe('jane.doe@vendor.example');
    expect(result?.listAddress).toBe('support@lists.example.com');
  });

  it('returns null when the feature flag is disabled', () => {
    process.env[FLAG] = 'false';
    expect(resolveListRewriteSender(parsedFixture())).toBeNull();
  });

  it('keeps the topmost Authentication-Results when duplicated', () => {
    const fixture = parsedFixture();
    // A later (lower) auth header for a different domain must not win.
    fixture.headerLines.push({
      key: 'authentication-results',
      line: 'Authentication-Results: relay.example; dmarc=pass header.from=evil.example',
    });
    const result = resolveListRewriteSender(fixture);
    expect(result?.sender.email).toBe('jane.doe@vendor.example');
  });
});
