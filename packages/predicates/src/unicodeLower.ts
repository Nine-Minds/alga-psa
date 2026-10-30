import unicode from './unicodeLower.v1.json' with { type: 'json' };

// The migration owns an immutable snapshot of these data. Never use the host's Unicode version
// for persisted v1 literals: Node upgrades must not change their database matching semantics.
const upper = Array.from(unicode.upper);
const lower = Array.from(unicode.lower);
const mapping = new Map(upper.map((character, index) => [character, lower[index]]));
const cased = new RegExp(unicode.cased, 'u');
const ignorable = new RegExp(unicode.ignorable, 'u');

export function unicodeLowerV1(input: string): string {
  const characters = Array.from(input);
  let previousCased = false;
  return characters.map((character, index) => {
    let folded: string;
    if (character === 'Σ') {
      let next = index + 1;
      while (next < characters.length && ignorable.test(characters[next])) next++;
      folded = previousCased && !(next < characters.length && cased.test(characters[next])) ? 'ς' : 'σ';
    } else {
      folded = (unicode.expand as Record<string, string>)[character] ?? mapping.get(character) ?? character;
    }
    if (!ignorable.test(character)) previousCased = cased.test(character);
    return folded;
  }).join('');
}
