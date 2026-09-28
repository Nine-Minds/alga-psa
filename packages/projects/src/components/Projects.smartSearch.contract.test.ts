/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('projects smart search wiring contract', () => {
  const source = read('./Projects.tsx');

  it('enters smart mode from Enter in the search box and from the Smart search button, gated on availability', () => {
    // The gate is evaluated in the server component and arrives as a prop.
    expect(source).toContain('smartSearchAvailable?: boolean;');
    expect(source).toContain('smartSearchAvailable = false }: ProjectsProps)');
    expect(source).not.toContain('useSmartSearchAvailability');
    expect(source).toContain("if (e.key === 'Enter' && smartSearchAvailable && (activeFilters.searchQuery ?? '').trim().length > 0) {");
    expect(source).toContain("runSmartSearch(activeFilters.searchQuery ?? '');");
    expect(source).toContain('id="projects-smart-search-run"');
    expect(source).toContain('{smartSearchAvailable && (');
  });

  it('scores the chip-filtered ids only: the typed text is the query, not a filter', () => {
    // The chips-only list exists apart from the keyword-filtered one.
    expect(source).toContain('const chipFilteredProjects = useMemo(() => {');
    expect(source).toContain('return chipFilteredProjects.filter(project =>');
    expect(source).toContain("(): ProjectSmartSearchScope => ({ projectIds: chipFilteredProjects.map((project) => project.project_id) })");
    // While smart mode owns the box, the keyword index search is not issued.
    const effectStart = source.indexOf('const query = activeFilters.searchQuery?.trim();');
    const effectEnd = source.indexOf('}, [activeFilters.searchQuery, smartSearch.active]);', effectStart);
    expect(effectStart).toBeGreaterThanOrEqual(0);
    expect(effectEnd).toBeGreaterThan(effectStart);
    expect(source.slice(effectStart, effectEnd)).toContain('if (smartSearch.active) {');
  });

  it('offers a rerun when the chip-filtered set changes', () => {
    expect(source).toContain('const smartSearchScopeStale = smartSearch.active && smartSearch.scopeKey !== smartSearchScopeKey;');
    expect(source).toContain('scopeStale={smartSearchScopeStale}');
    expect(source).toContain('onRerun={rerunSmartSearch}');
  });

  it('keeps the active run on its captured scope through chip changes', () => {
    // The panel is handed the run's captured scope, so a chip change with an
    // unchanged runToken only raises the rerun prompt and never replaces what
    // the active run is scoring.
    expect(source).toContain('scope={smartSearch.scope ?? smartSearchScope}');

    const runStart = source.indexOf('const runSmartSearch = useCallback(');
    const runEnd = source.indexOf('const exitSmartSearch', runStart);
    const run = source.slice(runStart, runEnd);
    expect(run).toContain('scope: smartSearchScope,');

    const rerunStart = source.indexOf('const rerunSmartSearch = useCallback(');
    const rerunEnd = source.indexOf('const exitSmartSearch', rerunStart);
    const rerun = source.slice(rerunStart, rerunEnd);
    expect(rerun).toContain('scope: smartSearchScope,');
    expect(rerun).toContain('runToken: prev.runToken + 1,');
  });

  it('replaces the paginated table with the results panel, sharing columns and hydrating through the by-id loader', () => {
    const regionStart = source.indexOf('<ShortcutActiveRegion id="projects-shortcut-region"');
    const regionEnd = source.indexOf('</ShortcutActiveRegion>', regionStart);
    const region = source.slice(regionStart, regionEnd);
    expect(region).toContain('{smartSearch.active ? (');
    expect(region).toContain('<SmartSearchResults<ProjectSmartSearchScope, IProject, ProjectSmartSearchRowMetadata>');
    expect(region).toContain('entity="project"');
    expect(region).toContain('i18nNamespace="features/projects"');
    expect(region).toContain('columns={columns}');
    expect(region).toContain('hydrateRows={hydrateSmartSearchRows}');
    expect(region).toContain('onRowMetadata={handleSmartSearchRowMetadata}');
    expect(region).toContain('onExit={exitSmartSearch}');
    expect(region).toContain('<DataTable');
    expect(source).toContain('const result = await loadProjectListItemsByIds(ids);');
  });

  it('folds streamed tags into the store the tag column reads from', () => {
    expect(source).toContain('projectTagsRef.current = { ...projectTagsRef.current, ...metadata.projectTags };');
  });

  it('leaves smart mode when the box is cleared and on Escape', () => {
    expect(source).toContain("if (smartSearch.active && !(activeFilters.searchQuery ?? '')) {");
    expect(source).toContain("} else if (e.key === 'Escape' && smartSearch.active) {");
  });

  it('does not mirror smart mode into the URL', () => {
    expect(source).not.toMatch(/params\.set\(['"]smart/);
    const builderStart = source.indexOf('function buildURLFromFilters');
    const builderEnd = source.indexOf('function parseFiltersFromSearch', builderStart);
    expect(source.slice(builderStart, builderEnd)).not.toContain('smart');
  });
});
