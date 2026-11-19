export type VariableType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "url"
  | "raw-html"
  | "array"
  | "object";

export type VariableAvailability =
  | "used"
  | "available-unused"
  | "referenced-missing";

export interface VariableDef {
  path: string;
  type: VariableType;
  description: string;
  example: string;
  concept: string[];
  availability: VariableAvailability;
  notes?: string;
  /** Ticket emails only: `client` is safe for both audiences, `msp` is staff only. */
  audience?: "client" | "msp";
}

export interface TemplateVariableRegistryEntry {
  category: string;
  variables: VariableDef[];
  contractInferred: boolean;
}

export type TemplateVariableRegistry = Record<
  string,
  TemplateVariableRegistryEntry
>;
