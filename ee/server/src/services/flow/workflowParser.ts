// src/shared/utils/workflowParser.ts

import * as P from 'parsimmon';

interface Node {
  name: string;
  type: string;
  position: [number, number];
  properties: { [key: string]: string };
}

interface Edge {
  from: string;
  to: string;
}

interface Property {
    key: string;
    value: string;
  }

export interface Workflow {
  name: string;
  description: string;
  nodes: Node[];
  edges: Edge[];
}

const workflowParser = P.createLanguage({
  _: () => P.optWhitespace,
  // Defines a parser for string literals
  String: () => 
    // Matches a string enclosed in double quotes
    // The regex pattern explained:
    // "         - Matches an opening double quote
    // (?:       - Start of a non-capturing group
    //   \\.     - Matches any escaped character (e.g., \", \\)
    //   |       - OR
    //   [^"\\]  - Matches any character that is not a double quote or backslash
    // )*        - Matches the previous group zero or more times
    // "         - Matches a closing double quote
    P.regex(/"(?:\\.|[^"\\])*"/)
      // Removes the enclosing double quotes from the matched string
      .map(s => s.slice(1, -1)),
  Number: () => P.regex(/[0-9]+/).map(Number),
  Identifier: () => P.regex(/[a-zA-Z_][a-zA-Z0-9_]*/),  
  
  // Defines a parser for a Property
  Property: r => P.seqMap(
    r._,                    // Consumes optional whitespace
    P.string('Property'),   // Matches the literal string "Property"
    r._,                    // Consumes optional whitespace
    r.String,               // Parses a string for the property key
    r._,                    // Consumes optional whitespace
    r.String,               // Parses a string for the property value
    // Function to construct a Property object from parsed values
    (_, __, ___, key, ____, value): Property => ({ key, value })
  ),

  NodeContent: r => P.seqMap(
    P.seqMap(
      P.string('Type'),
      r._,
      r.String,
      (_, __, type) => type
    ),
    r._,
    P.seqMap(
      P.string('Position'),
      r._,
      r.Number,
      r._,
      r.Number,
      (_, __, x, ___, y) => [x, y] as [number, number]
    ),
    r._,
    r.Property.many(),
    (type, _, position, __, properties) => ({ type, position, properties })
  ),

  Node: r => P.seqMap(
    r._,
    P.string('Node'),
    r._,
    r.String,
    r._,
    P.string('{'),
    r._,
    r.NodeContent,
    r._,
    P.string('}'),
    (_, __, ___, name, ____, _____, ______, content, _______, ________) => ({
      name,
      type: content.type,
      position: content.position,
      properties: Object.fromEntries(content.properties.map((p: Property) => [p.key, p.value]))
    })
  ),

  Edge: r => P.seqMap(
    r._,
    P.string('Edge'),
    r._,
    r.String,
    r._,
    r.String,
    (_, __, ___, from, ____, to) => ({ from, to })
  ),

  WorkflowContent: r => P.seqMap(
    P.seqMap(
      P.string('Description'),
      r._,
      r.String,
      (_, __, description) => description
    ),
    r._,
    r.Node.many(),
    r._,
    r.Edge.many(),
    (description, _, nodes, __, edges) => ({ description, nodes, edges })
  ),

  Workflow: r => P.seqMap(
    P.string('Workflow'),
    r._,
    r.String,
    r._,
    P.string('{'),
    r._,
    r.WorkflowContent,
    r._,
    P.string('}'),
    (_, __, name, ___, ____, _____, content, ______, _______) => ({
      name,
      description: content.description,
      nodes: content.nodes,
      edges: content.edges
    })
  ).trim(r._)
});

export function parseWorkflow(input: string): Workflow {
  return workflowParser.Workflow.tryParse(input.trim());
}
