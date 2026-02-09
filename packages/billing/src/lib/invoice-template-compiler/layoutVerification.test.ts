import { describe, expect, it } from 'vitest';
import { LayoutElementType } from '@alga-psa/types';
import type { InvoiceDesignerCompilerIr } from '../../components/invoice-designer/compiler/guiIr';
import {
  collectRenderedGeometryFromLayout,
  compareLayoutConstraints,
  extractExpectedLayoutConstraintsFromIr,
} from './layoutVerification';

const createFixtureIr = (): InvoiceDesignerCompilerIr => ({
  version: 1,
  rootNodeId: 'doc',
  flatNodes: [
    {
      id: 'doc',
      type: 'document',
      name: 'Document',
      parentId: null,
      childIds: ['field-1'],
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      rotation: 0,
      allowResize: false,
      layoutPresetId: null,
      layout: null,
      metadata: {},
    },
    {
      id: 'field-1',
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
      metadata: {},
    },
  ],
  tree: {
    id: 'doc',
    type: 'document',
    name: 'Document',
    parentId: null,
    childIds: ['field-1'],
    position: { x: 0, y: 0 },
    size: { width: 816, height: 1056 },
    rotation: 0,
    allowResize: false,
    layoutPresetId: null,
    layout: null,
    metadata: {},
    children: [
      {
        id: 'field-1',
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
        metadata: {},
        children: [],
      },
    ],
  },
  constraints: [],
});

describe('layoutVerification', () => {
  it('passes when rendered geometry stays within tolerance', () => {
    const ir = createFixtureIr();
    const constraints = extractExpectedLayoutConstraintsFromIr(ir, 3);
    const renderedLayout = {
      type: LayoutElementType.Document,
      id: 'doc',
      children: [
        {
          type: LayoutElementType.Text,
          id: 'field-1',
          content: 'INV-0001',
          style: {
            paddingLeft: '25px',
            marginTop: '31px',
            width: '219px',
            height: '50px',
          },
        },
      ],
    };

    const geometry = collectRenderedGeometryFromLayout(renderedLayout);
    const verification = compareLayoutConstraints(constraints, geometry);

    expect(verification.status).toBe('pass');
    expect(verification.mismatches).toHaveLength(0);
  });

  it('reports mismatches when rendered geometry exceeds tolerance', () => {
    const ir = createFixtureIr();
    const constraints = extractExpectedLayoutConstraintsFromIr(ir, 2);
    const renderedLayout = {
      type: LayoutElementType.Document,
      id: 'doc',
      children: [
        {
          type: LayoutElementType.Text,
          id: 'field-1',
          content: 'INV-0001',
          style: {
            paddingLeft: '40px',
            marginTop: '10px',
            width: '260px',
            height: '30px',
          },
        },
      ],
    };

    const geometry = collectRenderedGeometryFromLayout(renderedLayout);
    const verification = compareLayoutConstraints(constraints, geometry);

    expect(verification.status).toBe('issues');
    expect(verification.mismatches.length).toBeGreaterThan(0);
    expect(
      verification.mismatches.some((mismatch) => mismatch.constraintId === 'field-1:width')
    ).toBe(true);
  });

  it('extracts spacing/alignment/sizing/containment constraints from flex layout metadata', () => {
    const ir: InvoiceDesignerCompilerIr = {
      version: 1,
      rootNodeId: 'doc',
      flatNodes: [
        {
          id: 'doc',
          type: 'document',
          name: 'Document',
          parentId: null,
          childIds: ['section-1'],
          position: { x: 0, y: 0 },
          size: { width: 816, height: 1056 },
          rotation: 0,
          allowResize: false,
          layoutPresetId: null,
          layout: null,
          metadata: {},
        },
        {
          id: 'section-1',
          type: 'section',
          name: 'Section',
          parentId: 'doc',
          childIds: ['field-a', 'field-b'],
          position: { x: 32, y: 40 },
          size: { width: 600, height: 400 },
          rotation: 0,
          allowResize: true,
          layoutPresetId: null,
          layout: {
            mode: 'flex',
            direction: 'column',
            gap: 16,
            padding: 20,
            justify: 'start',
            align: 'center',
            sizing: 'fixed',
          },
          metadata: {},
        },
        {
          id: 'field-a',
          type: 'field',
          name: 'Field A',
          parentId: 'section-1',
          childIds: [],
          position: { x: 200, y: 20 },
          size: { width: 200, height: 40 },
          rotation: 0,
          allowResize: true,
          layoutPresetId: null,
          layout: null,
          metadata: {},
        },
        {
          id: 'field-b',
          type: 'field',
          name: 'Field B',
          parentId: 'section-1',
          childIds: [],
          position: { x: 200, y: 76 },
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
        childIds: ['section-1'],
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        rotation: 0,
        allowResize: false,
        layoutPresetId: null,
        layout: null,
        metadata: {},
        children: [],
      },
      constraints: [],
    };

    const constraints = extractExpectedLayoutConstraintsFromIr(ir, 2);
    const byId = new Map(constraints.map((constraint) => [constraint.id, constraint]));

    expect(byId.get('field-a:width')?.category).toBe('sizing');
    expect(byId.get('field-a:containment-x')?.category).toBe('containment');
    expect(byId.get('field-a:alignment-x')?.category).toBe('alignment');
    expect(byId.get('field-b:spacing-y')?.category).toBe('spacing');
    expect(byId.get('field-b:spacing-y')?.expected).toBe(76);
  });
});
