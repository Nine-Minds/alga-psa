/**
 * Named views of the ticket list, contributed per principal.
 *
 * A view is a label and a predicate group over the ticket query schema. The list does not know
 * which principals have views or what they mean: a package that owns a principal kind (the seat
 * technician is the first) registers a provider here, and the list composes the selected view's
 * predicates into the same filter group every other filter compiles through. The rows a view
 * returns and the count it shows therefore come from one predicate, and a view can only narrow:
 * it is ANDed with the caller's read authorization, never a substitute for it.
 *
 * Hot path: a provider answers from the facts already loaded with the subject. With no provider
 * registered, or a provider that does not recognise the subject, resolution reads nothing.
 *
 * Providers are held on globalThis so duplicated module instances (split Next bundles) share one registry.
 */
import type { PredicateClause, PredicateGroup } from '@alga-psa/predicates';
import type { AuthorizationSubject } from '@alga-psa/authorization/kernel/contracts';

export interface TicketListViewDefinition {
  /** Stable key; travels in `ITicketListFilters.listView` and the URL. */
  key: string;
  /** i18n key (features/tickets) and English default for the view's name. */
  labelKey: string;
  defaultLabel: string;
  /** Clauses ANDed into the list's filter group. Empty means no narrowing. */
  clauses: readonly PredicateClause[];
}

export interface TicketListViewProviderInput {
  tenant: string;
  subject: Pick<AuthorizationSubject, 'resolverFacts'>;
}

/** Null when the subject has no views. May be async only to consult a release gate for subjects it recognises. */
export type TicketListViewProvider = (input: TicketListViewProviderInput) => Promise<readonly TicketListViewDefinition[] | null> | readonly TicketListViewDefinition[] | null;

const STORE_KEY = Symbol.for('alga.tickets.listViewProviders');
const providers = (): Map<string, TicketListViewProvider> => {
  const host = globalThis as unknown as Record<symbol, Map<string, TicketListViewProvider> | undefined>;
  return (host[STORE_KEY] ??= new Map());
};

/** Idempotent per id: registering again replaces the earlier registration. */
export function registerTicketListViewProvider(id: string, provider: TicketListViewProvider): void {
  providers().set(id, provider);
}

/** The views offered to a subject: the first provider that recognises it wins. Empty when none does. */
export async function resolveTicketListViews(input: TicketListViewProviderInput): Promise<readonly TicketListViewDefinition[]> {
  for (const provider of providers().values()) {
    const views = await provider(input);
    if (views && views.length > 0) return views;
  }
  return [];
}

/**
 * The predicate group of the selected view. A key the subject is not offered selects nothing, so the
 * list is exactly what it would be without a view: authorization alone bounds it.
 */
export function ticketListViewPredicates(
  views: readonly TicketListViewDefinition[],
  key: string | null | undefined,
): PredicateGroup['clauses'] {
  const view = key ? views.find((candidate) => candidate.key === key) : undefined;
  return view ? [...view.clauses] : [];
}
