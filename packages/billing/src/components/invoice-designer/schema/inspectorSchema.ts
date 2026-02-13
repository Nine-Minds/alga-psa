export type DesignerInspectorSchema = {
  panels: DesignerInspectorPanel[];
};

export type DesignerInspectorPanel = {
  id: string;
  title: string;
  fields: DesignerInspectorField[];
};

export type DesignerInspectorField =
  | {
      kind: 'string';
      id: string;
      label: string;
      path: string;
      domId?: string;
      placeholder?: string;
    }
  | {
      kind: 'textarea';
      id: string;
      label: string;
      path: string;
      domId?: string;
      placeholder?: string;
    }
  | {
      kind: 'enum';
      id: string;
      label: string;
      path: string;
      domId?: string;
      options: Array<{ value: string; label: string }>;
    }
  | {
      kind: 'boolean';
      id: string;
      label: string;
      path: string;
      domId?: string;
    };

