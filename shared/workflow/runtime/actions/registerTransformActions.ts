import { z } from 'zod';
import { getActionRegistryV2 } from '../registries/actionRegistry';
import { compileExpression } from '../expressionEngine';
import { withWorkflowJsonSchemaMetadata } from '../jsonSchemaMetadata';
import {
  COMPOSE_TEXT_ACTION_ID,
  COMPOSE_TEXT_VERSION,
  composeTextResultSchema,
  renderComposeTextOutputs,
} from './composeText';

const coerceText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value);
};

const REGEX_MAX_TEXT_LENGTH = 100_000;
const REGEX_MAX_PATTERN_LENGTH = 2_000;
const REGEX_DEFAULT_MAX_MATCHES = 100;
const REGEX_MAX_MATCHES_LIMIT = 1_000;
const SUPPORTED_REGEX_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);

const validateRegexFlags = (flags: string, actionId: string): void => {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!SUPPORTED_REGEX_FLAGS.has(flag)) {
      throw new Error(`${actionId}: invalid regex flags "${flags}": unsupported flag "${flag}"`);
    }
    if (seen.has(flag)) {
      throw new Error(`${actionId}: invalid regex flags "${flags}": duplicate flag "${flag}"`);
    }
    seen.add(flag);
  }
};

const compileRegex = (pattern: string, flags: string, actionId: string): RegExp => {
  if (pattern.length > REGEX_MAX_PATTERN_LENGTH) {
    throw new Error(
      `${actionId}: pattern length ${pattern.length} exceeds maximum ${REGEX_MAX_PATTERN_LENGTH}`
    );
  }

  validateRegexFlags(flags, actionId);
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(
      `${actionId}: invalid regex pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const assertRegexTextLength = (text: string, actionId: string): void => {
  if (text.length > REGEX_MAX_TEXT_LENGTH) {
    throw new Error(
      `${actionId}: text length ${text.length} exceeds maximum ${REGEX_MAX_TEXT_LENGTH}`
    );
  }
};

const normalizeRegexGroups = (groups: string[] | undefined): Array<string | null> =>
  (groups ?? []).map((group) => group ?? null);

const normalizeNamedGroups = (groups: Record<string, string> | undefined): Record<string, string | null> => {
  if (!groups) return {};
  return Object.fromEntries(
    Object.entries(groups).map(([name, value]) => [name, value ?? null])
  );
};

const countRegexMatches = (regex: RegExp, text: string, maxMatches: number, actionId: string): number => {
  let count = 0;
  regex.lastIndex = 0;

  while (true) {
    const match = regex.exec(text);
    if (!match) break;
    count += 1;
    if (count > maxMatches) {
      throw new Error(`${actionId}: match count exceeded maximum ${maxMatches}`);
    }
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }
  return count;
};

const baseTextInputSchema = z.object({
  text: z.unknown().optional().describe('Source text to transform')
});

const textOutputSchema = z.object({
  text: z.string().describe('Transformed text output')
});

const arrayOutputSchema = z.object({
  items: z.array(z.string()).describe('Transformed string array output')
});

const genericArrayOutputSchema = z.object({
  items: z.array(z.unknown()).describe('Transformed array output')
});

const objectOutputSchema = z.object({
  object: z.record(z.unknown()).describe('Transformed object output')
});

const coalesceOutputSchema = z.object({
  value: z.unknown().optional().describe('First usable candidate value'),
  matchedIndex: z.number().int().nullable().describe('Zero-based index of the selected candidate')
});

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema),
]));

const jsonTypeSchema = z.enum(['object', 'array', 'string', 'number', 'boolean', 'null']);

const parseJsonOutputSchema = z.object({
  value: jsonValueSchema.describe('Parsed JSON value'),
  type: jsonTypeSchema.describe('Detected JSON type for the parsed value')
});

const queryJsonOutputSchema = z.object({
  value: jsonValueSchema.describe('Evaluated JSONata result')
});

const stringifyJsonOutputSchema = z.object({
  text: z.string().describe('Serialized JSON text')
});

const parseJsonInputSchema = z.object({
  source: z.union([z.string(), z.array(jsonValueSchema), z.record(jsonValueSchema)])
    .describe('JSON text or literal object/array to parse')
});

const queryJsonInputSchema = z.object({
  source: jsonValueSchema.describe('Input value exposed to expression as "source"'),
  expression: z.string().min(1).describe('JSONata expression to evaluate against source')
});

const stringifyJsonInputSchema = z.object({
  source: jsonValueSchema.describe('JSON-serializable value to serialize'),
  spacing: z.number().int().min(0).max(8).optional().describe('Optional pretty-print spacing between 0 and 8')
});

const regexTextInputSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const regexMatchInputSchema = z.object({
  text: regexTextInputSchema.describe('Source text to inspect'),
  pattern: withWorkflowJsonSchemaMetadata(
    z.string().min(1),
    'JavaScript regular expression pattern body (without surrounding /.../)',
    {
      'x-workflow-editor': {
        kind: 'text',
        inline: { mode: 'textarea' },
      }
    }
  ),
  flags: z.string().optional().default('').describe('Optional JavaScript regex flags (for example: i, m, s, g, u)'),
  requireMatch: z.boolean().optional().default(false).describe('When true, no-match is treated as an action failure')
});

const regexReplaceInputSchema = z.object({
  text: regexTextInputSchema.describe('Source text to modify'),
  pattern: withWorkflowJsonSchemaMetadata(
    z.string().min(1),
    'JavaScript regular expression pattern body (without surrounding /.../)',
    {
      'x-workflow-editor': {
        kind: 'text',
        inline: { mode: 'textarea' },
      }
    }
  ),
  flags: z.string().optional().default('').describe('Optional JavaScript regex flags (for example: i, m, s, u)'),
  replacement: withWorkflowJsonSchemaMetadata(
    z.string(),
    'Replacement string. JavaScript replacement tokens are supported, including $1, $2, $<name>, and $$.',
    {
      'x-workflow-editor': {
        kind: 'text',
        inline: { mode: 'textarea' },
      }
    }
  ),
  replaceAll: z.boolean().optional().default(true).describe('Replace all matches when true; otherwise replace only the first match')
});

const regexExtractInputSchema = z.object({
  text: regexTextInputSchema.describe('Source text to inspect'),
  pattern: withWorkflowJsonSchemaMetadata(
    z.string().min(1),
    'JavaScript regular expression pattern body (without surrounding /.../)',
    {
      'x-workflow-editor': {
        kind: 'text',
        inline: { mode: 'textarea' },
      }
    }
  ),
  flags: z.string().optional().default('').describe('Optional JavaScript regex flags (for example: i, m, s, g, u)'),
  maxMatches: z.number().int().positive().optional().default(REGEX_DEFAULT_MAX_MATCHES).describe(
    `Maximum matches to collect (1-${REGEX_MAX_MATCHES_LIMIT})`
  ),
  requireMatch: z.boolean().optional().default(false).describe('When true, no-match is treated as an action failure')
});

const regexMatchOutputSchema = z.object({
  matched: z.boolean(),
  match: z.string().nullable(),
  index: z.number().int().nullable(),
  groups: z.array(z.string().nullable()),
  namedGroups: z.record(z.string().nullable())
});

const regexExtractMatchSchema = z.object({
  text: z.string(),
  index: z.number().int(),
  groups: z.array(z.string().nullable()),
  namedGroups: z.record(z.string().nullable())
});

const regexExtractOutputSchema = z.object({
  matched: z.boolean(),
  count: z.number().int(),
  first: regexExtractMatchSchema.nullable(),
  matches: z.array(regexExtractMatchSchema),
});

const regexReplaceOutputSchema = z.object({
  text: z.string(),
  replacementCount: z.number().int(),
});

const assertJsonValue = (value: unknown, context: string): JsonValue => {
  const parsed = jsonValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${context}: parsed value is not a finite JSON value`);
  }
  return parsed.data;
};

const detectJsonType = (value: JsonValue): z.infer<typeof jsonTypeSchema> => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  throw new Error('Unsupported JSON value type');
};

function truncateText(
  text: string,
  maxLength: number,
  strategy: 'end' | 'start' | 'middle',
  ellipsis: string
): string {
  if (maxLength <= 0) return '';
  if (text.length <= maxLength) return text;
  if (!ellipsis) return text.slice(0, maxLength);
  if (ellipsis.length >= maxLength) return ellipsis.slice(0, maxLength);

  const available = maxLength - ellipsis.length;
  if (strategy === 'start') {
    return `${ellipsis}${text.slice(text.length - available)}`;
  }
  if (strategy === 'middle') {
    const head = Math.ceil(available / 2);
    const tail = Math.floor(available / 2);
    return `${text.slice(0, head)}${ellipsis}${text.slice(text.length - tail)}`;
  }
  return `${text.slice(0, available)}${ellipsis}`;
}

export function registerTransformActionsV2(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'transform.parse_json',
    version: 1,
    inputSchema: parseJsonInputSchema,
    outputSchema: parseJsonOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Parse JSON',
      category: 'Transform',
      description: 'Parse JSON text or pass through literal object/array values for downstream mapping.'
    },
    handler: async (input) => {
      if (typeof input.source === 'string') {
        try {
          const value = assertJsonValue(JSON.parse(input.source), 'JSON parse failed');
          return { value, type: detectJsonType(value) };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(message.startsWith('JSON parse failed:') ? message : `JSON parse failed: ${message}`);
        }
      }

      if (input.source !== null && typeof input.source === 'object') {
        if (!Array.isArray(input.source) && Object.getPrototypeOf(input.source) !== Object.prototype) {
          throw new Error('JSON parse failed: source object must be a plain object or array');
        }
        return { value: input.source, type: detectJsonType(input.source) };
      }

      throw new Error('JSON parse failed: source must be a JSON string or a literal object/array');
    }
  });

  registry.register({
    id: 'transform.query_json',
    version: 1,
    inputSchema: queryJsonInputSchema,
    outputSchema: queryJsonOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Query JSON',
      category: 'Transform',
      description: 'Evaluate a JSONata expression against a source value and return structured output.'
    },
    handler: async (input, ctx) => {
      const evaluationContext = {
        ...(ctx.expressionContext ?? {}),
        source: input.source
      };

      let compiled;
      try {
        compiled = compileExpression({ $expr: input.expression });
      } catch (error) {
        throw new Error(`JSON query expression validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        const value = await compiled.evaluate(evaluationContext);
        return { value };
      } catch (error) {
        throw new Error(`JSON query expression evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  registry.register({
    id: 'transform.stringify_json',
    version: 1,
    inputSchema: stringifyJsonInputSchema,
    outputSchema: stringifyJsonOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Stringify JSON',
      category: 'Transform',
      description: 'Serialize JSON-compatible values to text for storage, transport, or templating.'
    },
    handler: async (input) => {
      try {
        const spacing = input.spacing && input.spacing > 0 ? input.spacing : undefined;
        const text = JSON.stringify(input.source, null, spacing);
        if (typeof text !== 'string') {
          throw new Error('source must be JSON-serializable');
        }
        return { text };
      } catch (error) {
        throw new Error(`JSON stringify failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  registry.register({
    id: COMPOSE_TEXT_ACTION_ID,
    version: COMPOSE_TEXT_VERSION,
    inputSchema: z.object({}).strict(),
    outputSchema: composeTextResultSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Compose Text',
      category: 'Transform',
      description: 'Compose one or more markdown text outputs from literal content and workflow references.'
    },
    handler: async (_input, ctx) =>
      renderComposeTextOutputs(ctx.stepConfig, ctx.expressionContext)
  });

  registry.register({
    id: 'transform.regex_match',
    version: 1,
    inputSchema: regexMatchInputSchema,
    outputSchema: regexMatchOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Regex Match',
      category: 'Transform',
      description: 'Evaluate a JavaScript regular expression and return the first match with capture groups.'
    },
    handler: async (input) => {
      const actionId = 'transform.regex_match';
      const text = coerceText(input.text);
      assertRegexTextLength(text, actionId);

      const regex = compileRegex(input.pattern, input.flags ?? '', actionId);
      const match = regex.exec(text);

      if (!match) {
        if (input.requireMatch) {
          throw new Error(`${actionId}: no match found but requireMatch is true`);
        }
        return {
          matched: false,
          match: null,
          index: null,
          groups: [],
          namedGroups: {},
        };
      }

      return {
        matched: true,
        match: match[0] ?? null,
        index: typeof match.index === 'number' ? match.index : null,
        groups: normalizeRegexGroups(match.slice(1)),
        namedGroups: normalizeNamedGroups(match.groups),
      };
    }
  });

  registry.register({
    id: 'transform.regex_extract',
    version: 1,
    inputSchema: regexExtractInputSchema,
    outputSchema: regexExtractOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Regex Extract',
      category: 'Transform',
      description: 'Extract one or more regex matches with numbered and named capture groups.'
    },
    handler: async (input) => {
      const actionId = 'transform.regex_extract';
      const text = coerceText(input.text);
      assertRegexTextLength(text, actionId);

      const maxMatches = input.maxMatches ?? REGEX_DEFAULT_MAX_MATCHES;
      if (maxMatches > REGEX_MAX_MATCHES_LIMIT) {
        throw new Error(`${actionId}: maxMatches ${maxMatches} exceeds maximum ${REGEX_MAX_MATCHES_LIMIT}`);
      }

      const rawFlags = input.flags ?? '';
      const globalFlags = rawFlags.includes('g') ? rawFlags : `${rawFlags}g`;
      const regex = compileRegex(input.pattern, globalFlags, actionId);

      const matches: Array<z.infer<typeof regexExtractMatchSchema>> = [];
      regex.lastIndex = 0;

      while (matches.length < maxMatches) {
        const match = regex.exec(text);
        if (!match) break;
        matches.push({
          text: match[0] ?? '',
          index: match.index,
          groups: normalizeRegexGroups(match.slice(1)),
          namedGroups: normalizeNamedGroups(match.groups),
        });
        if (match[0].length === 0) {
          regex.lastIndex += 1;
        }
      }

      const matched = matches.length > 0;
      if (!matched && input.requireMatch) {
        throw new Error(`${actionId}: no match found but requireMatch is true`);
      }

      return {
        matched,
        count: matches.length,
        first: matches[0] ?? null,
        matches,
      };
    }
  });

  registry.register({
    id: 'transform.regex_replace',
    version: 1,
    inputSchema: regexReplaceInputSchema,
    outputSchema: regexReplaceOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Regex Replace',
      category: 'Transform',
      description: 'Replace regex matches using JavaScript RegExp replacement semantics.'
    },
    handler: async (input) => {
      const actionId = 'transform.regex_replace';
      const text = coerceText(input.text);
      assertRegexTextLength(text, actionId);

      const rawFlags = input.flags ?? '';
      const flags = input.replaceAll === false
        ? rawFlags.replace(/g/g, '')
        : rawFlags.includes('g')
          ? rawFlags
          : `${rawFlags}g`;
      const regex = compileRegex(input.pattern, flags, actionId);

      const replacementCount = input.replaceAll === false
        ? (regex.exec(text) ? 1 : 0)
        : countRegexMatches(regex, text, REGEX_MAX_MATCHES_LIMIT, actionId);

      regex.lastIndex = 0;
      const outputText = text.replace(regex, input.replacement);
      return {
        text: outputText,
        replacementCount,
      };
    }
  });

  registry.register({
    id: 'transform.truncate_text',
    version: 1,
    inputSchema: baseTextInputSchema.extend({
      maxLength: z.number().int().nonnegative().describe('Maximum output length'),
      strategy: z.enum(['end', 'start', 'middle']).default('end').describe('How truncated text should be shortened'),
      ellipsis: z.string().default('...').describe('Suffix or marker inserted when text is truncated')
    }),
    outputSchema: textOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Truncate Text',
      category: 'Transform',
      description: 'Shorten text using explicit truncation settings.'
    },
    handler: async (input) => ({
      text: truncateText(
        coerceText(input.text),
        input.maxLength,
        input.strategy ?? 'end',
        input.ellipsis ?? '...'
      )
    })
  });

  registry.register({
    id: 'transform.concat_text',
    version: 1,
    inputSchema: z.object({
      values: z.array(z.unknown()).default([]).describe('Ordered values to concatenate'),
      separator: z.string().default('').describe('Separator inserted between values')
    }),
    outputSchema: textOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Concat Text',
      category: 'Transform',
      description: 'Join multiple values into a single text result.'
    },
    handler: async (input) => {
      const values = input.values ?? [];
      return {
        text: values.map((value) => coerceText(value)).join(input.separator ?? '')
      };
    }
  });

  registry.register({
    id: 'transform.replace_text',
    version: 1,
    inputSchema: baseTextInputSchema.extend({
      search: z.string().describe('Text to replace'),
      replacement: z.string().default('').describe('Replacement text'),
      replaceAll: z.boolean().default(true).describe('Whether to replace every occurrence')
    }),
    outputSchema: textOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Replace Text',
      category: 'Transform',
      description: 'Replace matching text without writing an expression.'
    },
    handler: async (input) => {
      const text = coerceText(input.text);
      if (!input.search) return { text };
      return {
        text: input.replaceAll
          ? text.split(input.search).join(input.replacement ?? '')
          : text.replace(input.search, input.replacement ?? '')
      };
    }
  });

  registry.register({
    id: 'transform.split_text',
    version: 1,
    inputSchema: baseTextInputSchema.extend({
      delimiter: z.string().describe('Delimiter used to split the source text'),
      removeEmpty: z.boolean().default(false).describe('Whether to filter out empty segments')
    }),
    outputSchema: arrayOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Split Text',
      category: 'Transform',
      description: 'Split source text into an ordered string array.'
    },
    handler: async (input) => {
      const items = coerceText(input.text).split(input.delimiter);
      return {
        items: input.removeEmpty ? items.filter((item) => item.length > 0) : items
      };
    }
  });

  registry.register({
    id: 'transform.join_text',
    version: 1,
    inputSchema: z.object({
      items: z.array(z.unknown()).default([]).describe('Ordered values to join as text'),
      delimiter: z.string().default('').describe('Delimiter inserted between array items')
    }),
    outputSchema: textOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Join Text',
      category: 'Transform',
      description: 'Join an ordered list of values into a single text result.'
    },
    handler: async (input) => {
      const items = input.items ?? [];
      return {
        text: items.map((item) => coerceText(item)).join(input.delimiter ?? '')
      };
    }
  });

  registry.register({
    id: 'transform.lowercase_text',
    version: 1,
    inputSchema: baseTextInputSchema,
    outputSchema: textOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Lowercase Text',
      category: 'Transform',
      description: 'Convert source text to lowercase.'
    },
    handler: async (input) => ({
      text: coerceText(input.text).toLowerCase()
    })
  });

  registry.register({
    id: 'transform.uppercase_text',
    version: 1,
    inputSchema: baseTextInputSchema,
    outputSchema: textOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Uppercase Text',
      category: 'Transform',
      description: 'Convert source text to uppercase.'
    },
    handler: async (input) => ({
      text: coerceText(input.text).toUpperCase()
    })
  });

  registry.register({
    id: 'transform.trim_text',
    version: 1,
    inputSchema: baseTextInputSchema,
    outputSchema: textOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Trim Text',
      category: 'Transform',
      description: 'Trim leading and trailing whitespace from text.'
    },
    handler: async (input) => ({
      text: coerceText(input.text).trim()
    })
  });

  registry.register({
    id: 'transform.coalesce_value',
    version: 1,
    inputSchema: z.object({
      candidates: z.array(z.unknown()).default([]).describe('Ordered candidate values'),
      treatEmptyStringAsMissing: z.boolean().default(true).describe('Whether empty strings should be skipped')
    }),
    outputSchema: coalesceOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Coalesce Value',
      category: 'Transform',
      description: 'Return the first usable value from an ordered candidate list.'
    },
    handler: async (input) => {
      const candidates = input.candidates ?? [];
      const matchedIndex = candidates.findIndex((candidate) => {
        if (candidate === null || candidate === undefined) return false;
        if (input.treatEmptyStringAsMissing && typeof candidate === 'string') {
          return candidate.trim().length > 0;
        }
        return true;
      });

      return {
        value: matchedIndex === -1 ? undefined : candidates[matchedIndex],
        matchedIndex: matchedIndex === -1 ? null : matchedIndex
      };
    }
  });

  registry.register({
    id: 'transform.build_object',
    version: 1,
    inputSchema: z.object({
      fields: z.array(z.object({
        key: z.string().min(1).describe('Output field name'),
        value: z.unknown().optional().describe('Output field value')
      })).default([]).describe('Named fields to include in the output object')
    }),
    outputSchema: objectOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Build Object',
      category: 'Transform',
      description: 'Construct an object from explicit named inputs.'
    },
    handler: async (input) => {
      const fields = input.fields ?? [];
      return {
        object: Object.fromEntries(fields.map((field) => [field.key, field.value]))
      };
    }
  });

  registry.register({
    id: 'transform.pick_fields',
    version: 1,
    inputSchema: z.object({
      source: z.record(z.unknown()).nullable().default({}).describe('Source object to read from'),
      fields: z.array(z.string().min(1)).default([]).describe('Field names to keep from the source object')
    }),
    outputSchema: objectOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Pick Fields',
      category: 'Transform',
      description: 'Select a fixed subset of fields from an object.'
    },
    handler: async (input) => {
      const source = input.source ?? {};
      const fields = input.fields ?? [];
      return {
        object: Object.fromEntries(
          fields
            .filter((field) => Object.prototype.hasOwnProperty.call(source, field))
            .map((field) => [field, source[field]])
        )
      };
    }
  });

  registry.register({
    id: 'transform.rename_fields',
    version: 1,
    inputSchema: z.object({
      source: z.record(z.unknown()).default({}).describe('Source object to rename fields on'),
      renames: z.array(z.object({
        from: z.string().min(1).describe('Existing field name'),
        to: z.string().min(1).describe('New field name')
      })).default([]).describe('Explicit field rename mappings')
    }),
    outputSchema: objectOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Rename Fields',
      category: 'Transform',
      description: 'Rename object fields with explicit mapping entries.'
    },
    handler: async (input) => {
      const source = input.source ?? {};
      const renames = input.renames ?? [];
      const renamed = { ...source };
      for (const entry of renames) {
        if (!Object.prototype.hasOwnProperty.call(renamed, entry.from)) continue;
        renamed[entry.to] = renamed[entry.from];
        if (entry.to !== entry.from) {
          delete renamed[entry.from];
        }
      }
      return { object: renamed };
    }
  });

  registry.register({
    id: 'transform.append_array',
    version: 1,
    inputSchema: z.object({
      items: z.array(z.unknown()).default([]).describe('Source array'),
      values: z.array(z.unknown()).default([]).describe('Values to append to the source array')
    }),
    outputSchema: genericArrayOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Append Array',
      category: 'Transform',
      description: 'Append one or more values to an existing array.'
    },
    handler: async (input) => ({
      items: [...(input.items ?? []), ...(input.values ?? [])]
    })
  });

  registry.register({
    id: 'transform.build_array',
    version: 1,
    inputSchema: z.object({
      items: z.array(z.unknown()).default([]).describe('Ordered values for the output array')
    }),
    outputSchema: genericArrayOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Build Array',
      category: 'Transform',
      description: 'Construct an array from explicit ordered values.'
    },
    handler: async (input) => ({
      items: [...(input.items ?? [])]
    })
  });
}
