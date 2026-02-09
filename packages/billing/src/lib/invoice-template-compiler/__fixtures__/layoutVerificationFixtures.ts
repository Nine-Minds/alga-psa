import { LayoutElementType } from '@alga-psa/types';
import type { LayoutElement } from '@alga-psa/types';
import type { InvoiceDesignerCompilerIr } from '../../../components/invoice-designer/compiler/guiIr';

export type LayoutVerificationFixture = {
  name: string;
  tolerance: number;
  ir: InvoiceDesignerCompilerIr;
  renderedLayout: LayoutElement;
  expectedMismatchConstraintIds: string[];
};

const baseIr: InvoiceDesignerCompilerIr = {
  version: 1,
  rootNodeId: 'doc',
  flatNodes: [
    {
      id: 'doc',
      type: 'document',
      name: 'Document',
      parentId: null,
      childIds: ['number', 'totals'],
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      rotation: 0,
      allowResize: false,
      layoutPresetId: null,
      layout: null,
      metadata: {},
    },
    {
      id: 'number',
      type: 'field',
      name: 'Invoice Number',
      parentId: 'doc',
      childIds: [],
      position: { x: 24, y: 30 },
      size: { width: 220, height: 48 },
      rotation: 0,
      allowResize: true,
      layoutPresetId: null,
      layout: null,
      metadata: {
        bindingKey: 'invoice.number',
      },
    },
    {
      id: 'totals',
      type: 'totals',
      name: 'Totals',
      parentId: 'doc',
      childIds: [],
      position: { x: 560, y: 900 },
      size: { width: 200, height: 40 },
      rotation: 0,
      allowResize: true,
      layoutPresetId: null,
      layout: null,
      metadata: {},
    },
  ],
  tree: {
    id: 'doc',
    type: 'document',
    name: 'Document',
    parentId: null,
    childIds: ['number', 'totals'],
    position: { x: 0, y: 0 },
    size: { width: 816, height: 1056 },
    rotation: 0,
    allowResize: false,
    layoutPresetId: null,
    layout: null,
    metadata: {},
    children: [
      {
        id: 'number',
        type: 'field',
        name: 'Invoice Number',
        parentId: 'doc',
        childIds: [],
        position: { x: 24, y: 30 },
        size: { width: 220, height: 48 },
        rotation: 0,
        allowResize: true,
        layoutPresetId: null,
        layout: null,
        metadata: {
          bindingKey: 'invoice.number',
        },
        children: [],
      },
      {
        id: 'totals',
        type: 'totals',
        name: 'Totals',
        parentId: 'doc',
        childIds: [],
        position: { x: 560, y: 900 },
        size: { width: 200, height: 40 },
        rotation: 0,
        allowResize: true,
        layoutPresetId: null,
        layout: null,
        metadata: {},
        children: [],
      },
    ],
  },
  constraints: [],
};

export const PASSING_LAYOUT_FIXTURE: LayoutVerificationFixture = {
  name: 'aligned-layout',
  tolerance: 2,
  ir: baseIr,
  renderedLayout: {
    type: LayoutElementType.Document,
    id: 'doc',
    children: [
      {
        type: LayoutElementType.Text,
        id: 'number',
        content: 'INV-1001',
        style: {
          paddingLeft: '25px',
          marginTop: '31px',
          width: '219px',
          borderTop: '49px solid transparent',
        },
      },
      {
        type: LayoutElementType.Section,
        id: 'totals',
        children: [],
        style: {
          paddingLeft: '559px',
          marginTop: '901px',
          width: '201px',
          borderTop: '39px solid transparent',
        },
      },
    ],
  },
  expectedMismatchConstraintIds: [],
};

export const FAILING_LAYOUT_FIXTURE: LayoutVerificationFixture = {
  name: 'drifted-layout',
  tolerance: 2,
  ir: baseIr,
  renderedLayout: {
    type: LayoutElementType.Document,
    id: 'doc',
    children: [
      {
        type: LayoutElementType.Text,
        id: 'number',
        content: 'INV-1001',
        style: {
          paddingLeft: '24px',
          marginTop: '30px',
          width: '220px',
          borderTop: '48px solid transparent',
        },
      },
      {
        type: LayoutElementType.Section,
        id: 'totals',
        children: [],
        style: {
          paddingLeft: '530px',
          marginTop: '860px',
          width: '170px',
          borderTop: '20px solid transparent',
        },
      },
    ],
  },
  expectedMismatchConstraintIds: ['totals:x', 'totals:y', 'totals:width', 'totals:height'],
};
