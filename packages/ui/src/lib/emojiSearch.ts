/**
 * Shared emoji search utilities.
 * Lazy-loads emoji-mart data and provides search functionality.
 * Used by both the BlockNote emoji suggestion plugin and the reaction picker.
 */

let emojiReady = false;
let emojiInit: Promise<void> | null = null;

export async function ensureEmojiInit() {
  if (emojiReady) return;
  if (emojiInit) return emojiInit;
  emojiInit = (async () => {
    const [{ init }, data] = await Promise.all([
      import('emoji-mart'),
      import('@emoji-mart/data'),
    ]);
    await init({ data: data.default ?? data });
    emojiReady = true;
  })();
  return emojiInit;
}

export interface EmojiItem {
  id: string;
  native: string;
  name: string;
}

export async function searchEmoji(query: string): Promise<EmojiItem[]> {
  await ensureEmojiInit();
  const { SearchIndex } = await import('emoji-mart');
  const results = await SearchIndex.search(query);
  if (!results) return [];
  return results.slice(0, 30).map((e: any) => ({
    id: e.id,
    native: e.skins?.[0]?.native ?? '',
    name: e.name ?? e.id,
  }));
}
