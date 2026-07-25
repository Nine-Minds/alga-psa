import { ENTRA_DIRECT_DELEGATED_SCOPES } from '@ee/lib/integrations/entra/auth/directScopes';

/**
 * Everything the setup wizard decides that does not need the DOM: which step is
 * current, what the disclosure says, and what the "copy for a change record"
 * action puts on the clipboard. Kept pure so the decisions are testable without
 * rendering, the same reason buildEntraStatusHeaderAction was extracted in PR1.
 */

export type EntraSetupStepId = 'connect' | 'discover' | 'map' | 'sync';
export type EntraSetupStepState = 'current' | 'complete' | 'locked';

export const ENTRA_SETUP_STEP_IDS: readonly EntraSetupStepId[] = [
  'connect',
  'discover',
  'map',
  'sync',
] as const;

export interface EntraSetupProgress {
  isConnected: boolean;
  hasDiscovery: boolean;
  hasConfirmedMappings: boolean;
}

export interface EntraSetupStep {
  id: EntraSetupStepId;
  stepNumber: number;
  state: EntraSetupStepState;
}

export const deriveEntraSetupCurrentStep = (progress: EntraSetupProgress): EntraSetupStepId => {
  if (!progress.isConnected) return 'connect';
  if (!progress.hasDiscovery) return 'discover';
  if (!progress.hasConfirmedMappings) return 'map';
  return 'sync';
};

/**
 * The ladder. A step is complete when the work behind it is done, current when
 * it is the first incomplete one, and locked after that — the wizard renders
 * only the current step's action, so "locked" means "you cannot act here yet",
 * not merely "greyed out".
 */
export const deriveEntraSetupSteps = (progress: EntraSetupProgress): EntraSetupStep[] => {
  const currentStep = deriveEntraSetupCurrentStep(progress);
  const currentIndex = ENTRA_SETUP_STEP_IDS.indexOf(currentStep);

  return ENTRA_SETUP_STEP_IDS.map((id, index) => ({
    id,
    stepNumber: index + 1,
    state: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'locked',
  }));
};

/**
 * Setup owns the screen until one real sync has completed. The console never
 * reverts to setup afterwards — a connection that later breaks is an attention
 * item on the console, not a regression to onboarding.
 */
export type EntraSurfaceMode = 'setup' | 'console';

export const selectEntraSurfaceMode = (params: {
  hasCompletedFirstSync: boolean | null | undefined;
}): EntraSurfaceMode => (params.hasCompletedFirstSync ? 'console' : 'setup');

/**
 * The delegated scopes, each paired with the i18n key of its plain-English
 * gloss. Sourced from ENTRA_DIRECT_DELEGATED_SCOPES so the disclosure cannot
 * drift from what the OAuth request actually asks for — a disclosure that
 * under-reports is worse than none.
 */
export interface EntraScopeDisclosure {
  scope: string;
  glossKey: string;
}

const SCOPE_GLOSS_KEYS: Record<string, string> = {
  'https://graph.microsoft.com/User.Read': 'integrations.entra.setup.disclosure.scopes.userRead',
  'https://graph.microsoft.com/ManagedTenants.Read.All':
    'integrations.entra.setup.disclosure.scopes.managedTenants',
  'https://graph.microsoft.com/Directory.Read.All':
    'integrations.entra.setup.disclosure.scopes.directory',
  offline_access: 'integrations.entra.setup.disclosure.scopes.offlineAccess',
};

export const ENTRA_SCOPE_DISCLOSURES: EntraScopeDisclosure[] = ENTRA_DIRECT_DELEGATED_SCOPES.map(
  (scope) => ({
    scope,
    glossKey: SCOPE_GLOSS_KEYS[scope] || 'integrations.entra.setup.disclosure.scopes.unknown',
  })
);

/** The contact-effect contract, in the order it is read. */
export const ENTRA_CONTACT_EFFECT_KEYS: string[] = [
  'integrations.entra.setup.disclosure.contacts.matching',
  'integrations.entra.setup.disclosure.contacts.creation',
  'integrations.entra.setup.disclosure.contacts.overwrite',
  'integrations.entra.setup.disclosure.contacts.deletion',
];

/**
 * Plain text for the clipboard, so an operator can paste the disclosure into a
 * change record before asking a Global Admin to consent. Takes already
 * translated strings — the caller owns i18n, this owns the shape.
 */
export const buildEntraChangeRecord = (params: {
  heading: string;
  generatedAtLine: string;
  scopesHeading: string;
  scopes: Array<{ scope: string; gloss: string }>;
  contactsHeading: string;
  contactEffects: string[];
}): string => {
  const lines: string[] = [params.heading, params.generatedAtLine, '', params.scopesHeading];

  for (const entry of params.scopes) {
    lines.push(`- ${entry.scope}: ${entry.gloss}`);
  }

  lines.push('', params.contactsHeading);
  for (const effect of params.contactEffects) {
    lines.push(`- ${effect}`);
  }

  return lines.join('\n');
};
