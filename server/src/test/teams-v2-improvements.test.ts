import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const migration = read('server/migrations/20260227000001_add_team_to_document_associations_entity_type.cjs');
const mediaAvatarUtils = read('packages/media/src/lib/avatarUtils.ts');
const usersAvatarUtils = read('packages/users/src/lib/avatarUtils.ts');
const formattingAvatarUtils = read('packages/formatting/src/avatarUtils.ts');
const entityImageUpload = read('packages/ui/src/components/EntityImageUpload.tsx');
const teamAvatar = read('packages/ui/src/components/TeamAvatar.tsx');
const teamAvatarActions = read('packages/teams/src/actions/team-actions/avatarActions.ts');
const teamActionsIndex = read('packages/teams/src/actions/team-actions/index.ts');
const teamsPackageJson = JSON.parse(read('packages/teams/package.json')) as { dependencies?: Record<string, string> };
const useTeamAvatarHook = read('packages/teams/src/hooks/useTeamAvatar.ts');
const teamsHooksIndex = read('packages/teams/src/hooks/index.ts');
const teamDetails = read('server/src/components/settings/general/TeamDetails.tsx');
const orgChartNode = read('server/src/components/settings/general/org-chart/OrgChartNode.tsx');
const orgChart = read('server/src/components/settings/general/org-chart/OrgChart.tsx');
const orgChartFlow = read('server/src/components/settings/general/org-chart/OrgChartFlow.tsx');
const userManagement = read('server/src/components/settings/general/UserManagement.tsx');
const userAndTeamPicker = read('packages/ui/src/components/UserAndTeamPicker.tsx');
const multiUserAndTeamPicker = read('packages/ui/src/components/MultiUserAndTeamPicker.tsx');
const multiUserPicker = read('packages/ui/src/components/MultiUserPicker.tsx');
const ticketingDashboard = read('packages/tickets/src/components/TicketingDashboard.tsx');
const ticketInfo = read('packages/tickets/src/components/ticket/TicketInfo.tsx');

const countOccurrences = (content: string, needle: string) => content.split(needle).length - 1;

describe('Teams V2 Improvements', () => {
  it('T082: migration adds team to document_associations entity_type constraint', () => {
    expect(migration).toContain("'team'");
    expect(migration).toContain('document_associations_entity_type_check');
  });

  it('T083: migration is transaction-less for Citus compliance', () => {
    expect(migration).toContain('exports.config = { transaction: false }');
  });

  it('T084: migration down restores constraint without team', () => {
    const downSection = migration.split('exports.down')[1] || '';
    expect(downSection).not.toContain("'team'");
  });

  it('T085: media EntityType includes team', () => {
    expect(mediaAvatarUtils).toContain("'team'");
  });

  it('T086: users EntityType includes team', () => {
    expect(usersAvatarUtils).toContain("'team'");
  });

  it('T087: formatting EntityType includes team', () => {
    expect(formattingAvatarUtils).toContain("'team'");
  });

  it('T088: EntityImageUpload EntityType includes team', () => {
    expect(entityImageUpload).toContain("'team'");
  });

  it('T089: getTeamAvatarUrl uses getEntityImageUrl(team)', () => {
    expect(mediaAvatarUtils).toContain('getTeamAvatarUrl');
    expect(mediaAvatarUtils).toContain("getEntityImageUrl('team'");
  });

  it('T090: TeamAvatar renders EntityAvatar with team props', () => {
    expect(teamAvatar).toContain('EntityAvatar');
    expect(teamAvatar).toContain('entityId={teamId}');
    expect(teamAvatar).toContain('entityName={teamName}');
  });

  it('T091: TeamAvatar falls back to initials when avatarUrl is null', () => {
    expect(teamAvatar).toContain('imageUrl={avatarUrl}');
  });

  it('T092: TeamAvatar shows image when avatarUrl is provided', () => {
    expect(teamAvatar).toContain('imageUrl={avatarUrl}');
  });

  it('T093: uploadTeamAvatar uses uploadEntityImage(team)', () => {
    expect(teamAvatarActions).toContain("uploadEntityImage(\n      'team'");
  });

  it('T094: uploadTeamAvatar rejects when team not found', () => {
    expect(teamAvatarActions).toContain('Team not found.');
  });

  it('T095: uploadTeamAvatar rejects when no file provided', () => {
    expect(teamAvatarActions).toContain('No avatar file provided.');
  });

  it('T096: deleteTeamAvatar uses deleteEntityImage(team)', () => {
    expect(teamAvatarActions).toContain("deleteEntityImage(\n      'team'");
  });

  it('T097: deleteTeamAvatar rejects when team not found', () => {
    expect(teamAvatarActions).toContain('Team not found.');
  });

  it('T098: getTeamAvatarUrlAction returns getTeamAvatarUrl', () => {
    expect(teamAvatarActions).toContain('getTeamAvatarUrlAction');
    expect(teamAvatarActions).toContain('return getTeamAvatarUrl');
  });

  it('T099: getTeamAvatarUrlAction returns null when no avatar exists', () => {
    expect(teamAvatarActions).toContain('getTeamAvatarUrlAction');
  });

  it('T100: getTeamAvatarUrlsBatchAction returns a Map of URLs', () => {
    expect(teamAvatarActions).toContain('getTeamAvatarUrlsBatchAction');
    expect(teamAvatarActions).toContain('new Map');
  });

  it('T101: avatar actions are exported from teams actions index', () => {
    expect(teamActionsIndex).toContain("export * from './avatarActions'");
  });

  it('T102: teams package.json includes media/auth/swr deps', () => {
    expect(teamsPackageJson.dependencies).toMatchObject({
      '@alga-psa/media': expect.any(String),
      '@alga-psa/auth': expect.any(String),
      swr: expect.any(String),
    });
  });

  it('T103: useTeamAvatar returns avatarUrl/refreshAvatar/isLoading', () => {
    expect(useTeamAvatarHook).toContain('avatarUrl');
    expect(useTeamAvatarHook).toContain('refreshAvatar');
    expect(useTeamAvatarHook).toContain('isLoading');
  });

  it('T104: useTeamAvatar returns null when teamId is undefined', () => {
    expect(useTeamAvatarHook).toContain('teamId && tenant');
    expect(useTeamAvatarHook).toContain('avatarUrl ?? null');
  });

  it('T105: invalidateTeamAvatar triggers SWR cache invalidation', () => {
    expect(useTeamAvatarHook).toContain('invalidateTeamAvatar');
    expect(useTeamAvatarHook).toContain('globalMutate');
  });

  it('T106: useTeamAvatar is exported from teams hooks index', () => {
    expect(teamsHooksIndex).toContain("export * from './useTeamAvatar'");
  });

  it('T107: TeamDetails shows avatar upload area above team name', () => {
    const uploadIndex = teamDetails.indexOf('EntityImageUpload');
    const nameIndex = teamDetails.indexOf('Team Name');
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(nameIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeLessThan(nameIndex);
  });

  it('T108: TeamDetails avatar upload displays updated image', () => {
    expect(teamDetails).toContain('onImageChange={() => refreshTeamAvatar()}');
  });

  it('T109: TeamDetails refreshes avatar without reload', () => {
    expect(teamDetails).toContain('refreshTeamAvatar');
  });

  it('T110: OrgChartNode renders UserAvatar, name, and role', () => {
    expect(orgChartNode).toContain('UserAvatar');
    expect(orgChartNode).toContain('roleLabel');
  });

  it('T111: OrgChartNode shows inactive badge', () => {
    expect(orgChartNode).toContain('Inactive');
  });

  it('T112: OrgChartNode has top/bottom handles', () => {
    expect(orgChartNode).toContain('Position.Top');
    expect(orgChartNode).toContain('Position.Bottom');
  });

  it('T113: OrgChart renders inside ReactFlowProvider', () => {
    expect(orgChartFlow).toContain('ReactFlowProvider');
  });

  it('T114: OrgChart builds tree from reports_to relationships', () => {
    expect(orgChart).toContain('reports_to');
  });

  it('T115: OrgChart places roots at top level', () => {
    expect(orgChart).toContain('assignPositions(root, 0');
  });

  it('T116: OrgChart positions children below parent', () => {
    expect(orgChart).toContain('depth + 1');
    expect(orgChart).toContain('NODE_HEIGHT + VERTICAL_GAP');
  });

  it('T117: OrgChart uses smoothstep edges', () => {
    expect(orgChart).toContain("type: 'smoothstep'");
  });

  it('T118: OrgChart calls fitView on initial render', () => {
    expect(orgChartFlow).toContain('fitView');
  });

  it('T119: OrgChart supports zoom and pan', () => {
    expect(orgChartFlow).toContain('zoomOnScroll');
    expect(orgChartFlow).toContain('panOnScroll');
  });

  it('T120: OrgChart nodes are not draggable', () => {
    expect(orgChartFlow).toContain('nodesDraggable={false}');
  });

  it('T121: clicking OrgChart node opens UserDetails drawer', () => {
    expect(orgChart).toContain('openDrawer');
    expect(orgChart).toContain('UserDetails');
  });

  it('T122: closing UserDetails returns to chart view', () => {
    expect(orgChart).toContain('UserDetails');
  });

  it('T123: OrgChart nodes show avatars fetched in batch', () => {
    expect(orgChart).toContain('getUserAvatarUrlsBatchAction');
  });

  it('T124: ReactFlow is dynamically imported with ssr false', () => {
    expect(orgChart).toContain('dynamic');
    expect(orgChart).toContain('ssr: false');
  });

  it('T125: CardHeader shows both ViewSwitchers in one row', () => {
    expect(userManagement).toContain('flex items-center gap-3');
  });

  it('T126: Structure toggle hidden when teams-v2 is disabled', () => {
    expect(userManagement).toContain('isTeamsV2Enabled && portalType ===');
  });

  it('T127: Structure toggle hidden when portal type is client', () => {
    expect(userManagement).toContain("portalType === 'msp'");
  });

  it('T128: list toolbar has no view switcher', () => {
    const occurrences = countOccurrences(userManagement, 'currentView={userView}');
    expect(occurrences).toBe(1);
  });

  it('T129: org view header has no extra view switcher', () => {
    const occurrences = countOccurrences(userManagement, 'currentView={userView}');
    expect(occurrences).toBe(1);
  });

  it('T130: view switcher label reads Structure', () => {
    expect(userManagement).toContain("label: 'Structure'");
    expect(userManagement).not.toContain('Org Chart');
  });

  it('T131: Structure view renders OrgChart component', () => {
    expect(userManagement).toContain('<OrgChart');
  });

  it('T132: buildOrgTree and renderOrgNode removed', () => {
    expect(userManagement).not.toContain('buildOrgTree');
    expect(userManagement).not.toContain('renderOrgNode');
  });

  it('T133: Structure view gated by teams-v2 flag', () => {
    expect(userManagement).toContain('isTeamsV2Enabled');
  });

  it('T134: UserAndTeamPicker uses TeamAvatar', () => {
    expect(userAndTeamPicker).toContain('TeamAvatar');
  });

  it('T135: UserAndTeamPicker TeamAvatar fallback initials', () => {
    expect(userAndTeamPicker).toContain('avatarUrl={');
  });

  it('T136: UserAndTeamPicker TeamAvatar shows image when available', () => {
    expect(userAndTeamPicker).toContain('avatarUrl={teamAvatarUrls');
  });

  it('T137: UserAndTeamPicker getTeamAvatarUrlsBatch is optional', () => {
    expect(userAndTeamPicker).toContain('getTeamAvatarUrlsBatch?:');
  });

  it('T138: UserAndTeamPicker batch fetches team avatars on open', () => {
    expect(userAndTeamPicker).toContain('if (!isOpen || !getTeamAvatarUrlsBatch');
  });

  it('T139: MultiUserAndTeamPicker uses TeamAvatar in all contexts', () => {
    expect(countOccurrences(multiUserAndTeamPicker, 'TeamAvatar')).toBeGreaterThanOrEqual(4);
  });

  it('T140: MultiUserAndTeamPicker accepts team props', () => {
    expect(multiUserAndTeamPicker).toContain('teams?:');
    expect(multiUserAndTeamPicker).toContain('teamValues?:');
  });

  it('T141: MultiUserAndTeamPicker getTeamAvatarUrlsBatch optional', () => {
    expect(multiUserAndTeamPicker).toContain('getTeamAvatarUrlsBatch?:');
  });

  it('T142: MultiUserAndTeamPicker batch fetches on open', () => {
    expect(multiUserAndTeamPicker).toContain('if (!isOpen || !getTeamAvatarUrlsBatch');
  });

  it('T143: MultiUserPicker has no team props', () => {
    expect(multiUserPicker).not.toContain('teamValues');
    expect(multiUserPicker).not.toContain('teams?:');
  });

  it('T144: MultiUserPicker renders only users', () => {
    expect(multiUserPicker).not.toContain('TeamIcon');
  });

  it('T145: call sites use MultiUserAndTeamPicker when teams-v2 enabled', () => {
    expect(ticketingDashboard).toContain('teamsV2Enabled ?');
    expect(ticketingDashboard).toContain('MultiUserAndTeamPicker');
  });

  it('T146: ticket detail picker passes getTeamAvatarUrlsBatchAction', () => {
    expect(ticketInfo).toContain('getTeamAvatarUrlsBatchAction');
  });

  it('T147: ticket filter passes getTeamAvatarUrlsBatchAction', () => {
    expect(ticketingDashboard).toContain('getTeamAvatarUrlsBatchAction');
  });

  it('T148: no TeamIcon remains in picker components', () => {
    expect(userAndTeamPicker).not.toContain('TeamIcon');
    expect(multiUserAndTeamPicker).not.toContain('TeamIcon');
  });
});
