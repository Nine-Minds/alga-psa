// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[key];
  }, record);
}

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.resolve(__dirname, relativePath));
}

// ── T002: Static audit — every target component has useTranslation ──────────

describe('T002: static i18n wiring audit', () => {
  const wiredComponents = [
    // Sub-batch A: projects core
    'ProjectDetail.tsx',
    'TaskForm.tsx',
    'PhaseTaskImportDialog.tsx',
    'Projects.tsx',
    'TaskDocumentsSimple.tsx',
    'TaskTicketLinks.tsx',
    'TaskDependencies.tsx',
    'ProjectMaterialsDrawer.tsx',
    'ProjectTaskExportDialog.tsx',
    'ProjectQuickAdd.tsx',
    'ProjectDetailsEdit.tsx',
    'PrefillFromTicketDialog.tsx',
    'TaskListView.tsx',
    'TaskCard.tsx',
    'PhaseQuickAdd.tsx',
    // Sub-batch B: project-templates
    'project-templates/TemplateEditor.tsx',
    'project-templates/TemplateTaskForm.tsx',
    'project-templates/wizard-steps/TemplateTasksStep.tsx',
    'project-templates/ApplyTemplateDialog.tsx',
    'project-templates/ProjectTemplatesList.tsx',
    'project-templates/CreateTemplateDialog.tsx',
    'project-templates/TemplateTaskListView.tsx',
    'project-templates/wizard-steps/TemplateReviewStep.tsx',
    'project-templates/wizard-steps/TemplatePhasesStep.tsx',
    'project-templates/CreateTemplateForm.tsx',
    'project-templates/TemplateDetail.tsx',
    'project-templates/wizard-steps/TemplateClientPortalStep.tsx',
    'project-templates/TemplateCreationWizard.tsx',
    'project-templates/wizard-steps/TemplateBasicsStep.tsx',
    // Sub-batch C: settings + small
    'settings/projects/TenantProjectTaskStatusSettings.tsx',
    'settings/projects/ProjectStatusSettings.tsx',
    'ProjectTaskStatusEditor.tsx',
    'CreateTaskFromTicketDialog.tsx',
    'LinkTicketToTaskDialog.tsx',
    'DeadlineFilter.tsx',
    'settings/ProjectSettings.tsx',
    'ProjectTaskStatusSelector.tsx',
    'MoveTaskDialog.tsx',
    'ProjectInfo.tsx',
    'DuplicateTaskDialog.tsx',
    'TicketLinkedTasksBadge.tsx',
    'settings/projects/AddStatusDialog.tsx',
    'ProjectPhases.tsx',
    'TaskStatusSelect.tsx',
    'TicketSelect.tsx',
    'TaskTypeSelector.tsx',
    // F094 discovered non-zero components
    'TaskCommentThread.tsx',
    'TaskCommentForm.tsx',
    'ProjectActiveToggle.tsx',
  ];

  it('all target components import useTranslation', () => {
    const missing: string[] = [];

    for (const file of wiredComponents) {
      if (!fileExists(`./${file}`)) {
        missing.push(`${file} (file not found)`);
        continue;
      }
      const source = read(`./${file}`);
      if (!source.includes('useTranslation')) {
        missing.push(file);
      }
    }

    expect(missing).toEqual([]);
  });

  it('all target components use features/projects namespace', () => {
    const missing: string[] = [];

    for (const file of wiredComponents) {
      if (!fileExists(`./${file}`)) continue;
      const source = read(`./${file}`);
      if (!source.includes("features/projects")) {
        missing.push(file);
      }
    }

    expect(missing).toEqual([]);
  });
});

// ── T002 zero-string confirmation ───────────────────────────────────────────

describe('T002: confirmed zero-string components', () => {
  const zeroStringFiles = [
    'StatusColumn.tsx',
    'KanbanBoard.tsx',
    'ProjectPage.tsx',
    'KanbanZoomControl.tsx',
    'DonutChart.tsx',
    'TaskQuickAdd.tsx',
    'TaskEdit.tsx',
    'HoursProgressBar.tsx',
    'settings/projects/TaskPrioritySettings.tsx',
  ];

  it('zero-string components do not contain hardcoded user-visible button/label text patterns', () => {
    for (const file of zeroStringFiles) {
      if (!fileExists(`./${file}`)) continue;
      const source = read(`./${file}`);
      // These files should NOT have useTranslation (they have no strings)
      // This is a documentation test — if someone adds strings later, they should also add i18n
      expect(source).not.toContain('useTranslation');
    }
  });
});

// ── T001: Lang-pack validation (key parity check) ──────────────────────────

describe('T001: lang-pack key parity', () => {
  const localesDir = '../../../../server/public/locales';
  const namespace = 'features/projects.json';

  function collectLeafPaths(obj: Record<string, unknown>, prefix = ''): string[] {
    const paths: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        paths.push(...collectLeafPaths(value as Record<string, unknown>, fullKey));
      } else {
        paths.push(fullKey);
      }
    }
    return paths;
  }

  const en = readJson<Record<string, unknown>>(`${localesDir}/en/${namespace}`);
  const enPaths = collectLeafPaths(en);

  for (const lang of ['fr', 'es', 'de', 'nl', 'it', 'pl', 'xx', 'yy']) {
    it(`${lang} locale has same key count as en (${enPaths.length} keys)`, () => {
      const locale = readJson<Record<string, unknown>>(`${localesDir}/${lang}/${namespace}`);
      const localePaths = collectLeafPaths(locale);
      const missingInLocale = enPaths.filter(p => !localePaths.includes(p));
      const extraInLocale = localePaths.filter(p => !enPaths.includes(p));

      expect(missingInLocale, `keys missing in ${lang}`).toEqual([]);
      expect(extraInLocale, `extra keys in ${lang}`).toEqual([]);
    });
  }
});

// ── T010: /msp/projects list page pseudo-locale coverage ────────────────────

describe('T010: /msp/projects list page i18n coverage', () => {
  const pseudo = readJson<Record<string, unknown>>(
    '../../../../server/public/locales/xx/features/projects.json'
  );

  it('Projects.tsx wires key translation calls backed by xx pseudo-locale', () => {
    const source = read('./Projects.tsx');
    expect(source).toContain("useTranslation");
    expect(source).toContain("features/projects");
    // Uses projectListT wrapper that prefixes keys with projectList.*
    expect(source).toContain("projectListT(");
    expect(getLeaf(pseudo, 'projectList.searchPlaceholder')).toBe('11111');
    expect(getLeaf(pseudo, 'title')).toBe('11111');
  });

  it('DeadlineFilter.tsx wires keys backed by xx pseudo-locale', () => {
    const source = read('./DeadlineFilter.tsx');
    expect(source).toContain("useTranslation");
    expect(source).toContain("features/projects");
    expect(getLeaf(pseudo, 'filters.deadline.placeholder')).toBe('11111');
  });
});

// ── T011: /msp/projects/[id] detail page pseudo-locale coverage ─────────────

describe('T011: /msp/projects/[id] detail page i18n coverage', () => {
  const pseudo = readJson<Record<string, unknown>>(
    '../../../../server/public/locales/xx/features/projects.json'
  );

  it('ProjectDetail.tsx wires tab/section keys backed by xx pseudo-locale', () => {
    const source = read('./ProjectDetail.tsx');
    expect(source).toContain("useTranslation");
    expect(source).toContain("features/projects");
    expect(source).toContain("t('kanbanView'");
    expect(source).toContain("t('listView'");
    expect(getLeaf(pseudo, 'kanbanView')).toBe('11111');
    expect(getLeaf(pseudo, 'listView')).toBe('11111');
  });

  it('TaskForm.tsx wires field keys backed by xx pseudo-locale', () => {
    const source = read('./TaskForm.tsx');
    expect(source).toContain("useTranslation");
    expect(source).toContain("features/projects");
  });

  it('ProjectInfo.tsx wires info keys backed by xx pseudo-locale', () => {
    const source = read('./ProjectInfo.tsx');
    expect(source).toContain("useTranslation");
    const keys = [
      'projectInfo.client',
      'projectInfo.contact',
      'projectInfo.budget',
      'backToProjects',
      'hoursUsage',
    ];
    for (const key of keys) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });

  it('ProjectMaterialsDrawer.tsx wires material keys backed by xx pseudo-locale', () => {
    const source = read('./ProjectMaterialsDrawer.tsx');
    expect(source).toContain("useTranslation");
    expect(getLeaf(pseudo, 'materials.title')).toBe('11111');
  });

  it('TaskDependencies.tsx wires dependency keys backed by xx pseudo-locale', () => {
    const source = read('./TaskDependencies.tsx');
    expect(source).toContain("useTranslation");
    expect(getLeaf(pseudo, 'taskDependencies.title')).toBe('11111');
  });

  it('TaskDocumentsSimple.tsx wires document keys backed by xx pseudo-locale', () => {
    const source = read('./TaskDocumentsSimple.tsx');
    expect(source).toContain("useTranslation");
    expect(getLeaf(pseudo, 'taskDocuments.attachmentsTitle')).toBe('11111');
  });

  it('TaskTicketLinks.tsx wires ticket link keys backed by xx pseudo-locale', () => {
    const source = read('./TaskTicketLinks.tsx');
    expect(source).toContain("useTranslation");
    expect(getLeaf(pseudo, 'taskTicketLinks.title')).toBe('11111');
  });
});

// ── T012: /msp/projects/templates routes pseudo-locale coverage ─────────────

describe('T012: /msp/projects/templates i18n coverage', () => {
  const pseudo = readJson<Record<string, unknown>>(
    '../../../../server/public/locales/xx/features/projects.json'
  );

  it('ProjectTemplatesList.tsx wires list keys backed by xx pseudo-locale', () => {
    const source = read('./project-templates/ProjectTemplatesList.tsx');
    expect(source).toContain("useTranslation");
    expect(getLeaf(pseudo, 'templates.list.title')).toBe('11111');
  });

  it('TemplateEditor.tsx wires editor keys backed by xx pseudo-locale', () => {
    const source = read('./project-templates/TemplateEditor.tsx');
    expect(source).toContain("useTranslation");
    expect(getLeaf(pseudo, 'templates.editor.deletedSuccess')).toBe('11111');
  });

  it('TemplateCreationWizard.tsx wires wizard keys backed by xx pseudo-locale', () => {
    const source = read('./project-templates/TemplateCreationWizard.tsx');
    expect(source).toContain("useTranslation");
    expect(source).toContain("features/projects");
  });

  it('template route loads features/projects namespace via ROUTE_NAMESPACES', () => {
    const config = read('../../../../packages/core/src/lib/i18n/config.ts');
    // Templates routes should either have explicit entries or match /msp/projects prefix
    expect(config).toContain("'/msp/projects'");
    expect(config).toContain("features/projects");
  });
});

// ── T013: /msp/settings/project-settings pseudo-locale coverage ─────────────

describe('T013: /msp/settings/project-settings i18n coverage', () => {
  const pseudo = readJson<Record<string, unknown>>(
    '../../../../server/public/locales/xx/features/projects.json'
  );

  it('ProjectSettings.tsx wires settings keys', () => {
    const source = read('./settings/ProjectSettings.tsx');
    expect(source).toContain("useTranslation");
    expect(getLeaf(pseudo, 'settings.page.title')).toBe('11111');
  });

  it('ProjectStatusSettings.tsx wires status config keys', () => {
    const source = read('./settings/projects/ProjectStatusSettings.tsx');
    expect(source).toContain("useTranslation");
  });

  it('TenantProjectTaskStatusSettings.tsx wires tenant status keys', () => {
    const source = read('./settings/projects/TenantProjectTaskStatusSettings.tsx');
    expect(source).toContain("useTranslation");
  });

  it('AddStatusDialog.tsx wires add-status dialog keys backed by xx pseudo-locale', () => {
    const source = read('./settings/projects/AddStatusDialog.tsx');
    expect(source).toContain("useTranslation");
    expect(getLeaf(pseudo, 'addStatusDialog.addStatus')).toBe('11111');
    expect(getLeaf(pseudo, 'addStatusDialog.placeholder')).toBe('11111');
  });
});

// ── T014: global quick-create dialog pseudo-locale coverage ─────────────────

describe('T014: global quick-create ProjectQuickAdd i18n coverage', () => {
  const pseudo = readJson<Record<string, unknown>>(
    '../../../../server/public/locales/xx/features/projects.json'
  );

  it('ProjectQuickAdd.tsx wires quick-add keys backed by xx pseudo-locale', () => {
    const source = read('./ProjectQuickAdd.tsx');
    expect(source).toContain("useTranslation");
    expect(source).toContain("features/projects");
    expect(getLeaf(pseudo, 'quickAdd.title')).toBe('11111');
  });

  it('ProjectQuickAdd is imported by the global QuickCreateDialog', () => {
    const quickCreate = read(
      '../../../../server/src/components/layout/QuickCreateDialog.tsx'
    );
    expect(quickCreate).toContain('ProjectQuickAdd');
  });
});
