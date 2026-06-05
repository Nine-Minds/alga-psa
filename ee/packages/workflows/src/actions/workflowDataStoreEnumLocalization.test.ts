import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  WORKFLOW_ENTITY_TYPE_LABEL_DEFAULTS,
  WORKFLOW_ENTITY_TYPE_VALUES,
  WORKFLOW_LINK_RELATION_LABEL_DEFAULTS,
  WORKFLOW_LINK_RELATION_VALUES,
} from '../constants/workflowEnums';

const repoRoot = path.resolve(__dirname, '../../../../../');
const localesRoot = path.join(repoRoot, 'server/public/locales');
const workflowLocalePath = (locale: string) => path.join(localesRoot, locale, 'msp/workflows.json');

const DATA_STORE_ACTION_IDS = [
  'store.get',
  'store.set',
  'store.delete',
  'store.increment',
  'store.list',
  'store.list_namespaces',
  'links.upsert',
  'links.lookup',
  'links.delete',
  'links.list',
  'links.list_namespaces',
] as const;

const readWorkflowLocale = (locale: string) => JSON.parse(fs.readFileSync(workflowLocalePath(locale), 'utf8'));

describe('workflow data-store enum localization contracts', () => {
  it('T016: every workflow locale contains Data Store action, group, and enum keys', () => {
    const locales = fs.readdirSync(localesRoot)
      .filter((locale) => fs.existsSync(workflowLocalePath(locale)))
      .sort();

    expect(locales).toEqual(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'xx', 'yy']);

    for (const locale of locales) {
      const data = readWorkflowLocale(locale);
      expect(data.designer.palette.groups['data-store'].label).toEqual(expect.any(String));
      expect(data.designer.palette.groups['data-store'].description).toEqual(expect.any(String));

      for (const actionId of DATA_STORE_ACTION_IDS) {
        expect(data.designer.actions[actionId].label, `${locale}:${actionId}.label`).toEqual(expect.any(String));
        expect(data.designer.actions[actionId].description, `${locale}:${actionId}.description`).toEqual(expect.any(String));
      }

      for (const value of WORKFLOW_ENTITY_TYPE_VALUES) {
        expect(data.enums.workflowEntityType[value], `${locale}:workflowEntityType.${value}`).toEqual(expect.any(String));
      }
      for (const value of WORKFLOW_LINK_RELATION_VALUES) {
        expect(data.enums.workflowLinkRelation[value], `${locale}:workflowLinkRelation.${value}`).toEqual(expect.any(String));
      }
    }
  });

  it('T016: English labels match enum defaults and pseudo-locales avoid English bleed-through', () => {
    const en = readWorkflowLocale('en');
    expect(en.enums.workflowEntityType).toMatchObject(WORKFLOW_ENTITY_TYPE_LABEL_DEFAULTS);
    expect(en.enums.workflowLinkRelation).toMatchObject(WORKFLOW_LINK_RELATION_LABEL_DEFAULTS);

    for (const locale of ['xx', 'yy']) {
      const data = readWorkflowLocale(locale);
      const marker = locale === 'xx' ? '11111' : '55555';

      expect(data.designer.palette.groups['data-store'].label).toContain(marker);
      expect(data.designer.actions['store.get'].label).toContain(marker);
      expect(data.inputMappingEditor.softEnumPlaceholder).toContain(marker);

      for (const value of WORKFLOW_ENTITY_TYPE_VALUES) {
        expect(data.enums.workflowEntityType[value]).toContain(marker);
        expect(data.enums.workflowEntityType[value]).not.toBe(WORKFLOW_ENTITY_TYPE_LABEL_DEFAULTS[value]);
      }
      for (const value of WORKFLOW_LINK_RELATION_VALUES) {
        expect(data.enums.workflowLinkRelation[value]).toContain(marker);
        expect(data.enums.workflowLinkRelation[value]).not.toBe(WORKFLOW_LINK_RELATION_LABEL_DEFAULTS[value]);
      }
    }
  });
});
