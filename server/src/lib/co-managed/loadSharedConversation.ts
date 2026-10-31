import type { CoManagedConversationCursor, CoManagedConversationItem } from '@alga-psa/co-managed';

/** What the shared ticket screen needs from the admitted conversation: every page, plus the viewer's authority. */
export interface SharedConversationSnapshot<Page extends SharedConversationPage = SharedConversationPage> {
  items: CoManagedConversationItem[];
  actor: Page['actor'];
  writeAudiences: Page['writeAudiences'];
}
export interface SharedConversationPage {
  items: CoManagedConversationItem[];
  nextBefore: CoManagedConversationCursor | null;
  actor: { tenant: string; userId: string };
  writeAudiences: Array<'requester' | 'shared_it' | 'organization_private'>;
}

/** The native screen shows the whole thread, so every admitted page is read (bounded). */
export const MAX_SHARED_CONVERSATION_PAGES = 40;

export async function loadSharedConversation(
  fetchPage: (before?: CoManagedConversationCursor) => Promise<SharedConversationPage>,
): Promise<SharedConversationSnapshot> {
  const items: CoManagedConversationItem[] = [];
  let first: SharedConversationPage | null = null;
  let before: CoManagedConversationCursor | undefined;
  for (let page = 0; page < MAX_SHARED_CONVERSATION_PAGES; page++) {
    const screen = await fetchPage(before);
    first ??= screen;
    items.push(...screen.items);
    if (!screen.nextBefore) break;
    before = screen.nextBefore;
  }
  if (!first) throw new Error('Conversation unavailable');
  return { items, actor: first.actor, writeAudiences: first.writeAudiences };
}
