/* eslint-disable custom-rules/map-return-type */
import * as P from 'parsimmon';
import { Policy } from './abac';
import { ICondition } from '../../../../../server/src/interfaces/auth.interfaces';
import { UserAttributeKey, TicketAttributeKey } from '../../../../../server/src/lib/attributes/EntityAttributes';

const policyParser = P.createLanguage({
  // Basic parsers
  _: () => P.optWhitespace,
  word: () => P.regexp(/[a-zA-Z_][a-zA-Z0-9_]*/),
  string: () => P.regexp(/"((?:\\.|.)*?)"/, 1),
  number: () => P.regexp(/[0-9]+/).map(Number),

  // Policy elements
  action: r => r.word,
  resource: r => r.word,
  attribute: r => P.seqMap(r.word, P.string('.'), r.word, (obj, _, attr) => `${obj}.${attr}`),
  operator: () => P.alt(
    P.string('=='),
    P.string('!='),
    P.string('<'),
    P.string('<='),
    P.string('>'),
    P.string('>='),
    P.string('contains'),
    P.string('not contains')
  ),
  value: r => P.alt(r.string, r.number, r.word),
  condition: r => P.seqMap(
    r.attribute,
    r._,
    r.operator,
    r._,
    r.value,
    (attr, _, op, __, val) => ({
      userAttribute: attr.split('.')[1] as UserAttributeKey,
      operator: op,
      resourceAttribute: val as TicketAttributeKey
    } as ICondition)
  ),
  policy: r => P.seq(
    P.string('ALLOW'),
    r._,
    r.action,
    r._,
    P.string('ON'),
    r._,
    r.resource,
    r._,
    P.string('WHEN'),
    r._,
    r.condition.sepBy1(P.string('AND').trim(r._))
  ).map(([_, __, action, ___, ____, _____, resource, ______, _______, ________, conditions]) => 
    new Policy(
      `${action}_${resource}`, // policy_id (generated)
      `${action} ${resource}`, // policy_name (generated)
      resource,
      action,
      conditions
    )
  )
});

export function parsePolicy(policyString: string): Policy {
  return policyParser.policy.tryParse(policyString);
}
