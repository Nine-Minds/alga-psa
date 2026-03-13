import { z } from 'zod';
import { getActionRegistryV2 } from '../registries/actionRegistry';

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
    handler: async (input) => ({
      text: input.values.map((value) => coerceText(value)).join(input.separator ?? '')
    })
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
    handler: async (input) => ({
      text: input.items.map((item) => coerceText(item)).join(input.delimiter ?? '')
    })
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
}
