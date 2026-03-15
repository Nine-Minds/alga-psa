import { z } from 'zod';
import { getActionRegistryV2 } from '../registries/actionRegistry';
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
