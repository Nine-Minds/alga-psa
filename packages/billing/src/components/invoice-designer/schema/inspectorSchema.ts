import type { LucideIcon } from 'lucide-react';

export type DesignerInspectorSchema = {
  panels: DesignerInspectorPanel[];
};

export type DesignerInspectorVisibleWhen =
  | { kind: 'always' }
  | { kind: 'nodeIsContainer' }
  | { kind: 'nodeIsLeaf' }
  | { kind: 'pathEquals'; path: string; value: string }
  | { kind: 'parentPathEquals'; path: string; value: string };

/** Which translatable value a text field edits: a text node's content, or a field/totals-row label. */
export type DesignerInspectorTranslation = 'text-content' | 'node-label';

/** Inspector tabs: what the block shows, how it looks, and how it is laid out and sized. */
export type DesignerInspectorTab = 'content' | 'style' | 'layout';

export type DesignerInspectorPanel = {
  id: string;
  title: string;
  /** Defaults to 'content'. */
  tab?: DesignerInspectorTab;
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
      enableExpressionInsert?: boolean;
      /** Offers standard, recipient-translated labels for this text. */
      translation?: DesignerInspectorTranslation;
      /** Only affects the designer (never the document), so it is not an authored override. */
      designerOnly?: boolean;
      visibleWhen?: DesignerInspectorVisibleWhen;
    }
  | {
      kind: 'textarea';
      id: string;
      label: string;
      path: string;
      domId?: string;
      placeholder?: string;
      enableExpressionInsert?: boolean;
      translation?: DesignerInspectorTranslation;
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
      kind: 'icon-enum';
      id: string;
      label: string;
      path: string;
      domId?: string;
      options: Array<{ value: string; label: string; icon: LucideIcon; tooltip?: string }>;
      columns?: number;
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
      kind: 'css-length-stepper';
      id: string;
      label: string;
      path: string;
      domId?: string;
      allowedUnits?: Array<'px' | '%' | 'rem'>;
      defaultUnit?: 'px' | '%' | 'rem';
      visibleWhen?: DesignerInspectorVisibleWhen;
    }
  | {
      kind: 'css-length-box';
      id: string;
      label: string;
      path: string;
      domId?: string;
      allowedUnits?: Array<'px' | '%' | 'rem'>;
      defaultUnit?: 'px' | '%' | 'rem';
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
    }
  | {
      kind: 'widget';
      id: string;
      widget: 'table-editor';
      domId?: string;
      visibleWhen?: DesignerInspectorVisibleWhen;
    }
  | {
      kind: 'widget';
      id: string;
      widget: 'field-binding-picker';
      label: string;
      path: string;
      domId?: string;
      visibleWhen?: DesignerInspectorVisibleWhen;
    }
  | {
      kind: 'widget';
      id: string;
      widget: 'totals-rows-editor';
      domId?: string;
      visibleWhen?: DesignerInspectorVisibleWhen;
    };
