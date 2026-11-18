import type { Knex } from 'knex';
import type { LabelClass, TemplateAst } from '@alga-psa/types';

import { fetchLabelClassDefaultTemplate, getCustomDocumentTemplate } from '../document-templates/storage';
import { labelClassOfCustomTemplate } from '../label-template-ast/labelTemplates';
import {
  LABEL_CLASS_BY_STANDARD_CODE,
  LABEL_STANDARD_CODE_BY_CLASS,
} from '../label-template-ast/standardTemplates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolvedLabelTemplate =
  | {
      ok: true;
      /** Standard template code, or (for a custom) the template id: the name failures are reported under. */
      templateCode: string;
      /** Set for a tenant custom template; absent for a standard one (the renderer looks it up by code). */
      templateAst?: TemplateAst;
      source: 'explicit' | 'class-default' | 'standard';
    }
  | { ok: false; message: string };

/**
 * Which template a print uses: explicit `templateId` (a custom template's UUID or a standard code), else
 * the tenant's default for the label CLASS, else the class's standard template. A template of another class
 * is refused (`ok: false`, a 400 for the caller). Read-only. A stale default (deleted, or of the wrong
 * class) is skipped silently so a bad assignment can never stop a tag from printing.
 */
export async function resolveLabelTemplate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  labelClass: LabelClass,
  templateId?: string | null
): Promise<ResolvedLabelTemplate> {
  if (templateId) {
    if (LABEL_CLASS_BY_STANDARD_CODE[templateId]) {
      return LABEL_CLASS_BY_STANDARD_CODE[templateId] === labelClass
        ? { ok: true, templateCode: templateId, source: 'explicit' }
        : { ok: false, message: `Label template "${templateId}" does not print "${labelClass}" labels.` };
    }
    if (!UUID.test(templateId)) {
      return { ok: false, message: `Unknown label template "${templateId}".` };
    }
    const custom = await getCustomDocumentTemplate(knex, tenant, 'work-tag', templateId);
    if (!custom?.templateAst) {
      return { ok: false, message: 'Unknown label template.' };
    }
    if (labelClassOfCustomTemplate(custom.templateAst) !== labelClass) {
      return { ok: false, message: `Label template "${custom.name}" does not print "${labelClass}" labels.` };
    }
    return { ok: true, templateCode: custom.template_id, templateAst: custom.templateAst, source: 'explicit' };
  }

  const classDefault = await fetchLabelClassDefaultTemplate(knex, tenant, labelClass);
  if (classDefault) {
    const isStandard = Boolean(LABEL_CLASS_BY_STANDARD_CODE[classDefault.templateId ?? '']);
    const defaultClass = isStandard
      ? LABEL_CLASS_BY_STANDARD_CODE[classDefault.templateId as string]
      : labelClassOfCustomTemplate(classDefault.ast);
    if (defaultClass === labelClass && classDefault.templateId) {
      return isStandard
        ? { ok: true, templateCode: classDefault.templateId, source: 'class-default' }
        : { ok: true, templateCode: classDefault.templateId, templateAst: classDefault.ast, source: 'class-default' };
    }
  }

  return { ok: true, templateCode: LABEL_STANDARD_CODE_BY_CLASS[labelClass], source: 'standard' };
}
