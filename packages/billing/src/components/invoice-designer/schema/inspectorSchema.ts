export type DesignerInspectorSchema = {
  panels: DesignerInspectorPanel[];
};

export type DesignerInspectorVisibleWhen =
  | { kind: 'always' }
  | { kind: 'nodeIsContainer' }
  | { kind: 'pathEquals'; path: string; value: string }
  | { kind: 'parentPathEquals'; path: string; value: string };

export type DesignerInspectorPanel = {
  id: string;
  title: string;
  visibleWhen?: DesignerInspectorVisibleWhen;
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
      visibleWhen?: DesignerInspectorVisibleWhen;
    }
  | {
      kind: 'textarea';
      id: string;
      label: string;
      path: string;
      domId?: string;
      placeholder?: string;
      visibleWhen?: DesignerInspectorVisibleWhen;
    }
  | {
      kind: 'number';
      id: string;
      label: string;
      path: string;
      domId?: string;
      placeholder?: string;
      visibleWhen?: DesignerInspectorVisibleWhen;
    }
  | {
      kind: 'enum';
      id: string;
      label: string;
      path: string;
      domId?: string;
      options: Array<{ value: string; label: string }>;
      visibleWhen?: DesignerInspectorVisibleWhen;
    }
  | {
      kind: 'css-length';
      id: string;
      label: string;
      path: string;
      domId?: string;
      placeholder?: string;
      visibleWhen?: DesignerInspectorVisibleWhen;
    }
  | {
      kind: 'css-color';
      id: string;
      label: string;
      path: string;
      domId?: string;
      placeholder?: string;
      visibleWhen?: DesignerInspectorVisibleWhen;
    }
  | {
      kind: 'boolean';
      id: string;
      label: string;
      path: string;
      domId?: string;
      visibleWhen?: DesignerInspectorVisibleWhen;
    };
