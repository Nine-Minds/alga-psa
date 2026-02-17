import { z } from 'zod';
import type { InvoiceTemplateAst } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';

// Conservative allowlist for any identifier we emit into CSS selectors or custom property names.
// Note: these are embedded into selectors with a prefix (`.ast-...`) and custom properties with `--...`.
const CSS_SAFE_IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]+$/;
const cssIdentifierSchema = z
  .string()
  .min(1)
  .regex(CSS_SAFE_IDENTIFIER_REGEX, { message: 'Invalid CSS identifier.' });

const valueFormatSchema = z.enum(['text', 'number', 'currency', 'date']);

const styleDeclarationSchema = z.object({
  display: z.string().optional(),
  flexDirection: z.string().optional(),
  width: z.string().optional(),
  height: z.string().optional(),
  minWidth: z.string().optional(),
  minHeight: z.string().optional(),
  maxWidth: z.string().optional(),
  maxHeight: z.string().optional(),
  flexGrow: z.union([z.string(), z.number()]).optional(),
  flexShrink: z.union([z.string(), z.number()]).optional(),
  flexBasis: z.string().optional(),
  padding: z.string().optional(),
  margin: z.string().optional(),
  border: z.string().optional(),
  borderRadius: z.string().optional(),
  gap: z.string().optional(),
  justifyContent: z.string().optional(),
  alignItems: z.string().optional(),
  gridTemplateColumns: z.string().optional(),
  gridTemplateRows: z.string().optional(),
  gridAutoFlow: z.string().optional(),
  aspectRatio: z.string().optional(),
  objectFit: z.string().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  fontSize: z.string().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  fontFamily: z.string().optional(),
  lineHeight: z.union([z.string(), z.number()]).optional(),
  textAlign: z.enum(['left', 'center', 'right', 'justify']).optional(),
}).strict();

const nodeStyleRefSchema = z.object({
  tokenIds: z.array(cssIdentifierSchema).optional(),
  inline: styleDeclarationSchema.optional(),
}).strict();

const valueBindingSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('value'),
  path: z.string().min(1),
  fallback: z.unknown().optional(),
}).strict();

const collectionBindingSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('collection'),
  path: z.string().min(1),
}).strict();

const bindingRefSchema = z.object({
  bindingId: z.string().min(1),
}).strict();

type ValueExpressionInput =
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'binding'; bindingId: string }
  | { type: 'path'; path: string }
  | { type: 'template'; template: string; args?: Record<string, ValueExpressionInput> };

const valueExpressionSchema: z.ZodType<ValueExpressionInput> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('literal'),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }).strict(),
    z.object({
      type: z.literal('binding'),
      bindingId: z.string().min(1),
    }).strict(),
    z.object({
      type: z.literal('path'),
      path: z.string().min(1),
    }).strict(),
    z.object({
      type: z.literal('template'),
      template: z.string().min(1),
      args: z.record(z.string(), valueExpressionSchema).optional(),
    }).strict(),
  ])
);

type ComputationExpressionInput =
  | { type: 'literal'; value: number }
  | { type: 'path'; path: string }
  | { type: 'aggregate-ref'; aggregateId: string }
  | {
      type: 'binary';
      op: 'add' | 'subtract' | 'multiply' | 'divide';
      left: ComputationExpressionInput;
      right: ComputationExpressionInput;
    };

const computationExpressionSchema: z.ZodType<ComputationExpressionInput> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('literal'),
      value: z.number(),
    }).strict(),
    z.object({
      type: z.literal('path'),
      path: z.string().min(1),
    }).strict(),
    z.object({
      type: z.literal('aggregate-ref'),
      aggregateId: z.string().min(1),
    }).strict(),
    z.object({
      type: z.literal('binary'),
      op: z.enum(['add', 'subtract', 'multiply', 'divide']),
      left: computationExpressionSchema,
      right: computationExpressionSchema,
    }).strict(),
  ])
);

type PredicateInput =
  | {
      type: 'comparison';
      path: string;
      op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
      value: string | number | boolean | null | Array<string | number | boolean | null>;
    }
  | {
      type: 'logical';
      op: 'and' | 'or';
      conditions: PredicateInput[];
    }
  | {
      type: 'not';
      condition: PredicateInput;
    };

const predicateSchema: z.ZodType<PredicateInput> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('comparison'),
      path: z.string().min(1),
      op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in']),
      value: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
      ]),
    }).strict(),
    z.object({
      type: z.literal('logical'),
      op: z.enum(['and', 'or']),
      conditions: z.array(predicateSchema).min(1),
    }).strict(),
    z.object({
      type: z.literal('not'),
      condition: predicateSchema,
    }).strict(),
  ])
);

const transformBaseShape = {
  id: z.string().min(1),
  strategyId: z.string().min(1).optional(),
} as const;

const transformOperationSchema = z.discriminatedUnion('type', [
  z.object({
    ...transformBaseShape,
    type: z.literal('filter'),
    predicate: predicateSchema,
  }).strict(),
  z.object({
    ...transformBaseShape,
    type: z.literal('sort'),
    keys: z.array(z.object({
      path: z.string().min(1),
      direction: z.enum(['asc', 'desc']).optional(),
      nulls: z.enum(['first', 'last']).optional(),
    }).strict()).min(1),
  }).strict(),
  z.object({
    ...transformBaseShape,
    type: z.literal('group'),
    key: z.string().min(1),
    label: z.string().optional(),
  }).strict(),
  z.object({
    ...transformBaseShape,
    type: z.literal('aggregate'),
    aggregations: z.array(z.object({
      id: z.string().min(1),
      op: z.enum(['sum', 'count', 'avg', 'min', 'max']),
      path: z.string().min(1).optional(),
    }).strict()).min(1),
  }).strict(),
  z.object({
    ...transformBaseShape,
    type: z.literal('computed-field'),
    fields: z.array(z.object({
      id: z.string().min(1),
      expression: computationExpressionSchema,
    }).strict()).min(1),
  }).strict(),
  z.object({
    ...transformBaseShape,
    type: z.literal('totals-compose'),
    totals: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      value: computationExpressionSchema,
    }).strict()).min(1),
  }).strict(),
]);

type NodeInput =
  | {
      id: string;
      type: 'document';
      style?: z.infer<typeof nodeStyleRefSchema>;
      children: NodeInput[];
    }
  | {
      id: string;
      type: 'section';
      title?: string;
      style?: z.infer<typeof nodeStyleRefSchema>;
      children: NodeInput[];
    }
  | {
      id: string;
      type: 'stack';
      direction?: 'row' | 'column';
      style?: z.infer<typeof nodeStyleRefSchema>;
      children: NodeInput[];
    }
  | {
      id: string;
      type: 'text';
      style?: z.infer<typeof nodeStyleRefSchema>;
      content: ValueExpressionInput;
    }
  | {
      id: string;
      type: 'field';
      style?: z.infer<typeof nodeStyleRefSchema>;
      binding: z.infer<typeof bindingRefSchema>;
      label?: string;
      emptyValue?: string;
      format?: z.infer<typeof valueFormatSchema>;
    }
  | {
      id: string;
      type: 'image';
      style?: z.infer<typeof nodeStyleRefSchema>;
      src: ValueExpressionInput;
      alt?: ValueExpressionInput;
    }
  | {
      id: string;
      type: 'divider';
      style?: z.infer<typeof nodeStyleRefSchema>;
    }
  | {
      id: string;
      type: 'table';
      style?: z.infer<typeof nodeStyleRefSchema>;
      sourceBinding: z.infer<typeof bindingRefSchema>;
      rowBinding: string;
      columns: Array<{
        id: string;
        header?: string;
        value: ValueExpressionInput;
        format?: z.infer<typeof valueFormatSchema>;
        style?: z.infer<typeof nodeStyleRefSchema>;
      }>;
      emptyStateText?: string;
    }
  | {
      id: string;
      type: 'dynamic-table';
      style?: z.infer<typeof nodeStyleRefSchema>;
      repeat: {
        sourceBinding: z.infer<typeof bindingRefSchema>;
        itemBinding: string;
        keyPath?: string;
      };
      columns: Array<{
        id: string;
        header?: string;
        value: ValueExpressionInput;
        format?: z.infer<typeof valueFormatSchema>;
        style?: z.infer<typeof nodeStyleRefSchema>;
      }>;
      emptyStateText?: string;
    }
  | {
      id: string;
      type: 'totals';
      style?: z.infer<typeof nodeStyleRefSchema>;
      sourceBinding: z.infer<typeof bindingRefSchema>;
      rows: Array<{
        id: string;
        label: string;
        value: ValueExpressionInput;
        format?: z.infer<typeof valueFormatSchema>;
        emphasize?: boolean;
      }>;
    };

const nodeSchema: z.ZodType<NodeInput> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      id: z.string().min(1),
      type: z.literal('document'),
      style: nodeStyleRefSchema.optional(),
      children: z.array(nodeSchema),
    }).strict(),
    z.object({
      id: z.string().min(1),
      type: z.literal('section'),
      title: z.string().optional(),
      style: nodeStyleRefSchema.optional(),
      children: z.array(nodeSchema),
    }).strict(),
    z.object({
      id: z.string().min(1),
      type: z.literal('stack'),
      direction: z.enum(['row', 'column']).optional(),
      style: nodeStyleRefSchema.optional(),
      children: z.array(nodeSchema),
    }).strict(),
    z.object({
      id: z.string().min(1),
      type: z.literal('text'),
      style: nodeStyleRefSchema.optional(),
      content: valueExpressionSchema,
    }).strict(),
    z.object({
      id: z.string().min(1),
      type: z.literal('field'),
      style: nodeStyleRefSchema.optional(),
      binding: bindingRefSchema,
      label: z.string().optional(),
      emptyValue: z.string().optional(),
      format: valueFormatSchema.optional(),
    }).strict(),
    z.object({
      id: z.string().min(1),
      type: z.literal('image'),
      style: nodeStyleRefSchema.optional(),
      src: valueExpressionSchema,
      alt: valueExpressionSchema.optional(),
    }).strict(),
    z.object({
      id: z.string().min(1),
      type: z.literal('divider'),
      style: nodeStyleRefSchema.optional(),
    }).strict(),
    z.object({
      id: z.string().min(1),
      type: z.literal('table'),
      style: nodeStyleRefSchema.optional(),
      sourceBinding: bindingRefSchema,
      rowBinding: z.string().min(1),
      columns: z.array(z.object({
        id: z.string().min(1),
        header: z.string().optional(),
        value: valueExpressionSchema,
        format: valueFormatSchema.optional(),
        style: nodeStyleRefSchema.optional(),
      }).strict()).min(1),
      emptyStateText: z.string().optional(),
    }).strict(),
    z.object({
      id: z.string().min(1),
      type: z.literal('dynamic-table'),
      style: nodeStyleRefSchema.optional(),
      repeat: z.object({
        sourceBinding: bindingRefSchema,
        itemBinding: z.string().min(1),
        keyPath: z.string().min(1).optional(),
      }).strict(),
      columns: z.array(z.object({
        id: z.string().min(1),
        header: z.string().optional(),
        value: valueExpressionSchema,
        format: valueFormatSchema.optional(),
        style: nodeStyleRefSchema.optional(),
      }).strict()).min(1),
      emptyStateText: z.string().optional(),
    }).strict(),
    z.object({
      id: z.string().min(1),
      type: z.literal('totals'),
      style: nodeStyleRefSchema.optional(),
      sourceBinding: bindingRefSchema,
      rows: z.array(z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        value: valueExpressionSchema,
        format: valueFormatSchema.optional(),
        emphasize: z.boolean().optional(),
      }).strict()).min(1),
    }).strict(),
  ])
);

export const invoiceTemplateAstSchema = z.object({
  kind: z.literal('invoice-template-ast'),
  version: z.literal(INVOICE_TEMPLATE_AST_VERSION),
  metadata: z.object({
    templateName: z.string().optional(),
    description: z.string().optional(),
    locale: z.string().optional(),
    currencyCode: z.string().optional(),
  }).strict().optional(),
  styles: z.object({
    tokens: z.record(cssIdentifierSchema, z.object({
      id: cssIdentifierSchema,
      value: z.union([z.string(), z.number()]),
    }).strict()).optional(),
    classes: z.record(cssIdentifierSchema, styleDeclarationSchema).optional(),
  }).strict().optional(),
  bindings: z.object({
    values: z.record(z.string(), valueBindingSchema).optional(),
    collections: z.record(z.string(), collectionBindingSchema).optional(),
  }).strict().optional(),
  transforms: z.object({
    sourceBindingId: z.string().min(1),
    outputBindingId: z.string().min(1),
    operations: z.array(transformOperationSchema).min(1),
  }).strict().optional(),
  layout: nodeSchema,
}).strict();

export interface InvoiceTemplateAstValidationError {
  code: string;
  path: string;
  message: string;
}

export type InvoiceTemplateAstValidationResult =
  | {
      success: true;
      ast: InvoiceTemplateAst;
    }
  | {
      success: false;
      errors: InvoiceTemplateAstValidationError[];
    };

const issuePathToString = (path: (string | number)[]): string => path.map(String).join('.');

const toValidationError = (issue: z.ZodIssue): InvoiceTemplateAstValidationError => ({
  code: issue.code,
  path: issuePathToString(issue.path),
  message: issue.message,
});

export const validateInvoiceTemplateAst = (input: unknown): InvoiceTemplateAstValidationResult => {
  const parsed = invoiceTemplateAstSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map(toValidationError),
    };
  }

  return {
    success: true,
    ast: parsed.data as InvoiceTemplateAst,
  };
};

export const parseInvoiceTemplateAst = (input: unknown): InvoiceTemplateAst => {
  const result = validateInvoiceTemplateAst(input);
  if (!result.success) {
    const message = result.errors.map((error) =>
      `${error.path || '<root>'}: ${error.message}`
    ).join('; ');
    throw new Error(`Invalid invoice template AST. ${message}`);
  }
  return result.ast;
};
