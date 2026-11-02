import { describe, expect, it } from 'vitest';


import {
  ruleMatchesTicket,
  type ChecklistApplyRuleMatchers,
  type ChecklistRuleTicketInput,
} from './fixtures/legacyRuleMatcher';
import { ticketDescriptionFromAttributes, ticketDescriptionToPlainText } from './fixtures/legacyRuleMatcher';

const ACME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NEW_HIRE = '33333333-3333-4333-8333-333333333333';
const OFFBOARD = '44444444-4444-4444-8444-444444444444';

const emptyRule: ChecklistApplyRuleMatchers = {
  board_id: null,
  category_id: null,
  subcategory_id: null,
  priority_id: null,
};

const ticket = (over: Partial<ChecklistRuleTicketInput> = {}): ChecklistRuleTicketInput => ({
  board_id: 'b1',
  category_id: 'c1',
  subcategory_id: 's1',
  priority_id: 'p1',
  client_id: ACME,
  ticket_origin: 'client_portal',
  title: 'Onboarding for Jane',
  description: 'Please set up laptop',
  fromServiceRequest: false,
  serviceRequestDefinitionId: null,
  ...over,
});

const rule = (over: Partial<ChecklistApplyRuleMatchers>): ChecklistApplyRuleMatchers => ({
  ...emptyRule,
  ...over,
});

describe('ruleMatchesTicket', () => {
  it('matches anything when no matcher is set', () => {
    expect(ruleMatchesTicket(emptyRule, ticket())).toBe(true);
    expect(ruleMatchesTicket(emptyRule, ticket({ client_id: null, ticket_origin: null, title: null, description: null }))).toBe(true);
  });

  it('treats empty arrays, empty/blank keywords and false toggles as "any"', () => {
    const r = rule({ client_ids: [], ticket_origins: [], keywords: ['  ', ''], from_service_request: false });
    expect(ruleMatchesTicket(r, ticket())).toBe(true);
  });

  it('keeps the original board/category/subcategory/priority equality semantics', () => {
    expect(ruleMatchesTicket(rule({ board_id: 'b1' }), ticket())).toBe(true);
    expect(ruleMatchesTicket(rule({ board_id: 'b2' }), ticket())).toBe(false);
    expect(ruleMatchesTicket(rule({ category_id: 'c2' }), ticket())).toBe(false);
    expect(ruleMatchesTicket(rule({ subcategory_id: 's2' }), ticket())).toBe(false);
    expect(ruleMatchesTicket(rule({ priority_id: 'p2' }), ticket())).toBe(false);
  });

  it('client_ids must contain the ticket client', () => {
    expect(ruleMatchesTicket(rule({ client_ids: [ACME, OTHER] }), ticket())).toBe(true);
    expect(ruleMatchesTicket(rule({ client_ids: [OTHER] }), ticket())).toBe(false);
    expect(ruleMatchesTicket(rule({ client_ids: [ACME] }), ticket({ client_id: null }))).toBe(false);
  });

  it('ticket_origins must contain the ticket origin', () => {
    expect(ruleMatchesTicket(rule({ ticket_origins: ['client_portal', 'api'] }), ticket())).toBe(true);
    expect(ruleMatchesTicket(rule({ ticket_origins: ['api'] }), ticket())).toBe(false);
    expect(ruleMatchesTicket(rule({ ticket_origins: ['api'] }), ticket({ ticket_origin: null }))).toBe(false);
  });

  it('from_service_request requires a service-request ticket', () => {
    const r = rule({ from_service_request: true });
    expect(ruleMatchesTicket(r, ticket())).toBe(false);
    expect(ruleMatchesTicket(r, ticket({ fromServiceRequest: true, serviceRequestDefinitionId: OFFBOARD }))).toBe(true);
  });

  it('a named definition requires that exact definition, even without the toggle', () => {
    const r = rule({ service_request_definition_id: NEW_HIRE });
    expect(ruleMatchesTicket(r, ticket())).toBe(false);
    expect(ruleMatchesTicket(r, ticket({ fromServiceRequest: true, serviceRequestDefinitionId: OFFBOARD }))).toBe(false);
    expect(ruleMatchesTicket(r, ticket({ fromServiceRequest: true, serviceRequestDefinitionId: NEW_HIRE }))).toBe(true);
  });

  describe('keywords', () => {
    it('is case-insensitive, trims, and uses substring matching', () => {
      expect(ruleMatchesTicket(rule({ keywords: ['  ONBOARD '] }), ticket())).toBe(true);
      expect(ruleMatchesTicket(rule({ keywords: ['offboarding'] }), ticket())).toBe(false);
    });

    it('does not treat keywords as regex', () => {
      expect(ruleMatchesTicket(rule({ keywords: ['on.*ing'] }), ticket())).toBe(false);
    });

    it('any = at least one keyword, all = every keyword', () => {
      const keywords = ['onboarding', 'laptop'];
      const t = ticket({ title: 'Onboarding for Jane', description: 'no hardware' });
      expect(ruleMatchesTicket(rule({ keywords, keyword_mode: 'any' }), t)).toBe(true);
      expect(ruleMatchesTicket(rule({ keywords, keyword_mode: 'all' }), t)).toBe(false);
      expect(ruleMatchesTicket(rule({ keywords, keyword_mode: 'all' }), ticket())).toBe(true);
    });

    it('defaults to any / title_and_description when mode and target are null', () => {
      const r = rule({ keywords: ['laptop'], keyword_mode: null, keyword_target: null });
      expect(ruleMatchesTicket(r, ticket())).toBe(true);
    });

    it('keyword_target limits which field is searched', () => {
      const t = ticket({ title: 'Hello', description: 'contains onboarding' });
      expect(ruleMatchesTicket(rule({ keywords: ['onboarding'], keyword_target: 'title' }), t)).toBe(false);
      expect(ruleMatchesTicket(rule({ keywords: ['onboarding'], keyword_target: 'description' }), t)).toBe(true);
      expect(ruleMatchesTicket(rule({ keywords: ['onboarding'], keyword_target: 'title_and_description' }), t)).toBe(true);
      const t2 = ticket({ title: 'Onboarding', description: 'x' });
      expect(ruleMatchesTicket(rule({ keywords: ['onboarding'], keyword_target: 'description' }), t2)).toBe(false);
    });

    it('all across title_and_description may be satisfied by different fields', () => {
      const r = rule({ keywords: ['jane', 'laptop'], keyword_mode: 'all' });
      expect(ruleMatchesTicket(r, ticket({ title: 'Jane', description: 'laptop' }))).toBe(true);
    });

    it('does not match across the title/description boundary', () => {
      const r = rule({ keywords: ['janelaptop'] });
      expect(ruleMatchesTicket(r, ticket({ title: 'Jane', description: 'laptop' }))).toBe(false);
    });

    it('handles missing title/description', () => {
      expect(ruleMatchesTicket(rule({ keywords: ['x'] }), ticket({ title: null, description: null }))).toBe(false);
    });
  });

  describe('card example: client = Acme AND from service request "New hire" AND title contains "onboarding"', () => {
    const cardRule = rule({
      client_ids: [ACME],
      service_request_definition_id: NEW_HIRE,
      from_service_request: true,
      keywords: ['onboarding'],
      keyword_target: 'title',
    });
    const good = ticket({ fromServiceRequest: true, serviceRequestDefinitionId: NEW_HIRE, title: 'New hire onboarding: Jane' });

    it('matches the intended ticket', () => {
      expect(ruleMatchesTicket(cardRule, good)).toBe(true);
    });

    it('does not match a different client', () => {
      expect(ruleMatchesTicket(cardRule, { ...good, client_id: OTHER })).toBe(false);
    });

    it('near-miss: same client, different definition', () => {
      expect(ruleMatchesTicket(cardRule, { ...good, serviceRequestDefinitionId: OFFBOARD })).toBe(false);
    });

    it('near-miss: keyword only in the description while target is title', () => {
      expect(
        ruleMatchesTicket(cardRule, { ...good, title: 'New hire: Jane', description: 'onboarding checklist please' })
      ).toBe(false);
    });

    it('near-miss: not from a service request at all', () => {
      expect(ruleMatchesTicket(cardRule, { ...good, fromServiceRequest: false, serviceRequestDefinitionId: null })).toBe(false);
    });
  });
});

describe('ticketDescriptionFromAttributes', () => {
  it('reads attributes.description from an object or JSON string', () => {
    expect(ticketDescriptionFromAttributes({ description: 'hi' })).toBe('hi');
    expect(ticketDescriptionFromAttributes('{"description":"hi"}')).toBe('hi');
    expect(ticketDescriptionFromAttributes(null)).toBeNull();
    expect(ticketDescriptionFromAttributes('not json')).toBeNull();
    expect(ticketDescriptionFromAttributes({ description: 3 })).toBeNull();
  });
});

describe('BlockNote descriptions are matched on visible text only', () => {
  const blocks = [
    {
      id: 'b1',
      type: 'paragraph',
      props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
      content: [{ type: 'text', text: 'Mouse is broken, needs replacing', styles: {} }],
      children: [],
    },
  ];
  const VISIBLE = 'Mouse is broken, needs replacing';
  const shapes: Record<string, unknown> = {
    'BlockNote JSON string': JSON.stringify(blocks),
    'parsed BlockNote array': blocks,
    'attributes as JSON string': JSON.stringify({ description: JSON.stringify(blocks) }),
    'attributes with parsed array': { description: blocks },
    'plain string': VISIBLE,
  };

  for (const [name, input] of Object.entries(shapes)) {
    it(`${name}: flattens to visible text; "left" misses, "mouse" hits`, () => {
      const isAttrs = name.startsWith('attributes');
      const text = isAttrs ? ticketDescriptionFromAttributes(input) : ticketDescriptionToPlainText(input);
      expect(text).toBe(VISIBLE);
      for (const keyword_target of ['description', 'title_and_description'] as const) {
        const t = ticket({ title: 'Broken peripheral', description: text });
        expect(ruleMatchesTicket(rule({ keywords: ['left'], keyword_target }), t)).toBe(false);
        expect(ruleMatchesTicket(rule({ keywords: ['mouse'], keyword_target }), t)).toBe(true);
      }
    });
  }

  it('passes plain/markdown strings through unchanged, including JSON-looking scalars', () => {
    expect(ticketDescriptionToPlainText('**bold** text')).toBe('**bold** text');
    expect(ticketDescriptionToPlainText('123')).toBe('123');
    expect(ticketDescriptionToPlainText('null')).toBe('null');
    expect(ticketDescriptionToPlainText('[x] done')).toBe('[x] done');
  });

  it('returns null for empty / unusable input and flattens ProseMirror docs', () => {
    expect(ticketDescriptionToPlainText('')).toBeNull();
    expect(ticketDescriptionToPlainText('   ')).toBeNull();
    expect(ticketDescriptionToPlainText(null)).toBeNull();
    expect(ticketDescriptionToPlainText(42)).toBeNull();
    expect(ticketDescriptionToPlainText({ foo: 'left' })).toBeNull();
    expect(ticketDescriptionToPlainText([])).toBeNull();
    expect(ticketDescriptionToPlainText([{ type: 'paragraph', content: [], children: [] }])).toBeNull();
    expect(
      ticketDescriptionToPlainText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] })
    ).toBe('hello');
  });
});
