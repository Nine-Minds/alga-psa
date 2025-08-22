/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable custom-rules/map-return-type */
import P from "parsimmon";

interface GlobalCalculation {
  type: 'calculation';
  name: string;
  expression: {
    operation: string;
    field: string;
  };
  isGlobal: boolean;
}

export const InvoiceLanguage = P.createLanguage({
  _: () => P.regexp(/\s*/),
  identifier: () => P.regexp(/[a-zA-Z_][a-zA-Z0-9_.]*/),
  string: () => P.alt(
    P.regexp(/"((?:\\.|.)*?)"/, 1),
    P.regexp(/'((?:\\.|.)*?)'/, 1)
  ).map(s => s.replace(/\\'/g, "'").replace(/\\"/g, '"')).desc('string'),
  number: () => P.regexp(/[0-9]+(?:\.[0-9]+)?/).map(Number).desc('number'),
  boolean: () => P.alt(P.string('true'), P.string('false')).map(s => s === 'true').desc('boolean'),
  blankLine: () => P.regexp(/^\s*$/m),
  staticText: (r) => P.seqMap(
    P.string('text'),
    r._,
    P.alt(
      P.seq(r.identifier, r._, P.string(':'), r._),
      P.succeed(null)
    ),
    r.string,
    r._,
    P.string('at'),
    r._,
    r.gridPosition,
    r._,
    P.alt(r.gridSpan, P.succeed({ columnSpan: 1, rowSpan: 1 })),
    (_, __, idSeq, content, ___, ____, _____, position, ______, span) => ({
      type: 'staticText',
      id: idSeq ? idSeq[0] : undefined,
      content,
      position,
      span: span || { columnSpan: 1, rowSpan: 1 }
    })
  ),
  list: (r) => P.seq(
    P.string('list'),
    r._,
    r.identifier,
    r._,
    P.alt(
      P.seq(
        P.string('group'),
        r._,
        P.string('by'),
        r._,
        r.identifier
      ),
      P.succeed(null)
    ),
    r._,
    P.string('{'),
    r._,
    r.listContent.many(),
    r._,
    P.string('}')
  ).map(([
    _1, _2, name, _3, groupBy, _4, _5, _6, content
  ]) => ({
    type: 'list',
    name,
    groupBy: groupBy ? groupBy[4] : null,
    content
  })),

  listContent: (r) => P.alt(
    r.field,
    r.calculation,
    r.style,
    r.conditional,
    r.staticText
  ).skip(r._),

  // Section definition with grid layout
  section: (r) => P.seq(
    P.string('section'),
    r._,
    r.identifier,
    r._,
    r.gridDefinition,
    r._,
    P.string('{'),
    r._,
    r.sectionContent.many(),
    r._,
    P.string('}')
  ).map(([_1, _2, name, _3, grid, _4, _5, _6, content, _7, _8]) => ({ type: 'section', name, grid, content })),

  sectionContent: (r) => P.alt(
    r.field,
    r.list,
    r.calculation,
    r.style,
    r.conditional,
    r.staticText    
  ).skip(r._),

  // Grid definition
  gridDefinition: (r) => P.seqMap(
    P.string('grid'),
    r._,
    r.number,
    r._,
    P.string('x'),
    r._,
    r.number,
    (_, __, columns, ___, ____, _____, minRows) => ({ columns, minRows })
  ),

  // Field placement using grid coordinates and span
  field: (r) => P.seqMap(
    P.string('field'),
    r._,
    r.identifier,
    r._,
    P.string('at'),
    r._,
    r.gridPosition,
    r._,
    P.alt(r.gridSpan, P.succeed({ columnSpan: 1, rowSpan: 1 })),
    (_, __, name, ___, ____, _____, position, ______, span) => ({ 
      type: 'field', 
      name, 
      position, 
      span: span || { columnSpan: 1, rowSpan: 1 } 
    })
  ),

  // Grid position
  gridPosition: (r) => P.seqMap(
    r.number,
    r._,
    r.number,
    (column, _, row) => ({ column, row })
  ),

  // Grid span (optional)
  gridSpan: (r) => P.seqMap(
    P.string('span'),
    r._,
    r.number,
    r._,
    r.number,
    (_, __, columnSpan, ___, rowSpan) => ({ columnSpan, rowSpan })
  ),

  // Grouping definition
  group: (r) => P.seqMap(
    P.string('group'),
    r._,
    r.identifier,
    r._,
    P.string('by'),
    r._,
    r.identifier,
    (_, __, name, ___, ____, _____, groupBy) => ({ type: 'group', name, groupBy })
  ),

  // Calculation definition
  calculation: (r: any) => P.seqMap(
    P.alt(P.string('global').skip(r._).result(true), P.succeed(false)),
    P.string('calculate'),
    r._,
    r.identifier,
    r._,
    P.string('as'),
    r._,
    r.calculationExpression,
    r._,
    P.alt(r.listReference, P.succeed(undefined)),
    (isGlobal: boolean, _1: unknown, _2: unknown, name: string, _3: unknown, _4: unknown, _5: unknown, expression: any, _6: unknown, listRef: any) => ({ 
      type: 'calculation', 
      name, 
      expression,
      isGlobal,
      ...(listRef !== undefined ? { listReference: listRef } : {})
    })
  ),

  listReference: (r: any) => P.seqMap(
    P.string('from'),
    r._,
    r.identifier,
    (_a: unknown, _b: unknown, listName: string) => listName
  ),

  calculationExpression: (r: any) => P.alt(
    P.seqMap(
      P.string('sum'),
      r._,
      r.identifier,
      (_a: unknown, _b: unknown, field: string) => ({ operation: 'sum', field })
    ),
    P.seqMap(
      P.string('count'),
      r._,
      r.identifier,
      (_a: unknown, _b: unknown, field: string) => ({ operation: 'count', field })
    ),
    P.seqMap(
      P.string('avg'),
      r._,
      r.identifier,
      (_a: unknown, _b: unknown, field: string) => ({ operation: 'avg', field })
    )
  ),

  cssIdentifier: () => P.regexp(/[a-zA-Z_-][a-zA-Z0-9_-]*/).desc('css identifier'),

  style: (r: any) => P.seqMap(
    P.string('style'),
    r._,
    P.sepBy1(
      P.alt(
        P.seqMap(
          P.string('text'),
          r._,
          r.identifier,
          (_, __, id) => `text:${id}`
        ),
        r.identifier
      ),
      P.seq(r._, P.string(','), r._)
    ),
    r._,
    P.string('{'),
    r._,
    r.styleProp.many(),
    r._,
    P.string('}'),
    (_a: unknown, _b: unknown, elements: any[], _c: unknown, _d: unknown, _e: unknown, props: any[]) => ({ 
      type: 'style', 
      elements: elements.map((e: any) => typeof e === 'string' ? e : e.join('')), 
      props: Object.fromEntries(props) 
    })
  ),

  cssValue: () => P.alt(
    P.regexp(/[0-9]+(?:\.[0-9]+)?/).map(Number),
    P.regexp(/'[^']*'|"[^"]*"/).map((s: string) => s.slice(1, -1))
  ).desc('css value'),

  styleProp: (r: any) => P.seqMap(
    r.cssIdentifier,
    r._,
    P.string(':'),
    r._,
    r.cssValue,
    r._,
    P.string(';'),
    r._,
    (key: string, _1: unknown, _2: unknown, _3: unknown, value: string | number) => [key, value]
  ),

  // Conditional rendering
  conditional: (r: any) => P.seq(
    P.string('if'),
    r._,
    r.condition,
    r._,
    P.string('then'),
    r._,
    P.string('{'),
    r._,
    r.sectionContent.many(),
    r._,
    P.string('}')
  ).map(([_1, _2, condition, _3, _4, _5, _6, _7, content, _8, _9]: any[]) => ({
    type: 'conditional',
    condition,
    content
  })),


  condition: (r) => P.seqMap(
    r.identifier,
    r._,
    P.alt(P.string('=='), P.string('!='), P.string('>'), P.string('<'), P.string('>='), P.string('<=')),
    r._,
    P.alt(r.string, r.number, r.boolean),
    (field: string, _1: unknown, op: '==' | '!=' | '>' | '<' | '>=' | '<=', _2: unknown, value: string | number | boolean) => ({ field, op, value })
  ),

  // The entire invoice template
  invoiceTemplate: (r: any) => P.seq(
    r._,
    P.sepBy(r.section, r._),
    r._
  ).map(([_, sections]: [unknown, any[]]) => {
    const globals: GlobalCalculation[] = [];
    const processedSections = sections.map((section: any) => {
      const newContent = section.content.filter((item: any) => {
        if (item.type === 'calculation' && item.isGlobal) {
          globals.push(item);
          return false;
        }
        return true;
      });
      return { ...section, content: newContent };
    });
    return { sections: processedSections, globals };
  }),
});

// // Function to parse the DSL
export function parseInvoiceTemplate(input: string) {
  return InvoiceLanguage.invoiceTemplate.tryParse(input);
}
