import React, { useEffect, useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import {
  Ticket,
  Building2,
  User,
  FolderKanban,
  Monitor,
  Loader2,
} from 'lucide-react';
import {
  searchEntitiesForMention,
  type MentionableEntity,
  type MentionableEntityType,
  type MentionSearchResults,
} from '../../lib/chat-actions/searchEntitiesForMention';

const typeLabels: Record<MentionableEntityType, string> = {
  ticket: 'Tickets',
  client: 'Clients',
  contact: 'Contacts',
  project: 'Projects',
  asset: 'Assets',
  user: 'Users',
};

const typeIcons: Record<MentionableEntityType, React.ElementType> = {
  ticket: Ticket,
  client: Building2,
  contact: User,
  project: FolderKanban,
  asset: Monitor,
  user: User,
};

const CATEGORY_ORDER: MentionableEntityType[] = [
  'ticket',
  'client',
  'contact',
  'project',
  'asset',
  'user',
];

export interface ChatMentionPopupHandle {
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
}

interface ChatMentionPopupProps {
  query: string;
  onSelect: (entity: MentionableEntity) => void;
  onDismiss: () => void;
  placement?: 'above' | 'below';
}

export const ChatMentionPopup = forwardRef<ChatMentionPopupHandle, ChatMentionPopupProps>(
  function ChatMentionPopup({ query, onSelect, onDismiss, placement = 'above' }, ref) {
    const [results, setResults] = useState<MentionSearchResults>({});
    const [loading, setLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const popupRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onSelectRef = useRef(onSelect);
    useEffect(() => {
      onSelectRef.current = onSelect;
    }, [onSelect]);
    const queryRef = useRef(query);
    useEffect(() => {
      queryRef.current = query;
    }, [query]);
    const resultsRef = useRef<MentionSearchResults>(results);
    useEffect(() => {
      resultsRef.current = results;
    }, [results]);

    // Flatten results into a single ordered list for keyboard navigation
    const flatItems: MentionableEntity[] = [];
    for (const category of CATEGORY_ORDER) {
      const items = results[category];
      if (items && items.length > 0) {
        flatItems.push(...items);
      }
    }

    // Auto-select when the query uniquely identifies one entity: exactly one
    // result's matchName (or displayName) equals the query (case-insensitive)
    // and no other result has that query as a proper prefix. Returns true if
    // auto-selection fired.
    const tryAutoSelect = useCallback(
      (data: MentionSearchResults, q: string): boolean => {
        const queryNorm = q.trim().toLowerCase();
        if (queryNorm.length === 0) return false;

        const allItems: MentionableEntity[] = [];
        for (const category of CATEGORY_ORDER) {
          const items = data[category];
          if (items) allItems.push(...items);
        }
        const normalize = (s: string) => s.trim().toLowerCase();
        const keyOf = (item: MentionableEntity) =>
          normalize(item.matchName ?? item.displayName);
        const exactMatches = allItems.filter((item) => keyOf(item) === queryNorm);
        const hasExtension = allItems.some((item) => {
          const key = keyOf(item);
          return key.startsWith(queryNorm) && key !== queryNorm;
        });
        if (exactMatches.length === 1 && !hasExtension) {
          onSelectRef.current(exactMatches[0]);
          return true;
        }
        return false;
      },
      [],
    );

    // Search when query changes
    useEffect(() => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Fast path: if the previously-loaded results already contain a unique
      // match for the current query, auto-select immediately instead of
      // waiting for another debounced search round-trip. Lets typing a space
      // after a complete name fire auto-select without a visible delay.
      if (tryAutoSelect(resultsRef.current, query)) {
        return;
      }

      setLoading(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const data = await searchEntitiesForMention(query);
          setResults(data);
          setSelectedIndex(0);

          // Guard against stale searches: only auto-select if the query the
          // popup is currently showing matches the one we searched for.
          if (queryRef.current === query) {
            tryAutoSelect(data, query);
          }
        } catch {
          setResults({});
        } finally {
          setLoading(false);
        }
      }, 200);

      return () => {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
      };
    }, [query, tryAutoSelect]);

    // Keyboard handler exposed via ref
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent): boolean => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % Math.max(flatItems.length, 1));
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + Math.max(flatItems.length, 1)) % Math.max(flatItems.length, 1));
          return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          if (flatItems.length > 0) {
            e.preventDefault();
            onSelect(flatItems[selectedIndex]);
            return true;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onDismiss();
          return true;
        }
        return false;
      },
      [flatItems, selectedIndex, onSelect, onDismiss],
    );

    useImperativeHandle(ref, () => ({ handleKeyDown }), [handleKeyDown]);

    // Scroll selected item into view
    useEffect(() => {
      const popup = popupRef.current;
      if (!popup) return;
      const selected = popup.querySelector('[data-selected="true"]');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }, [selectedIndex]);

    let flatIndex = 0;

    const placementClass =
      placement === 'below' ? 'chat-mention-popup--below' : 'chat-mention-popup--above';

    return (
      <div className={`chat-mention-popup ${placementClass}`} ref={popupRef}>
        {loading && flatItems.length === 0 ? (
          <div className="chat-mention-popup__loading">
            <Loader2 size={16} className="chat-mention-popup__spinner" />
            <span>Searching…</span>
          </div>
        ) : flatItems.length === 0 ? (
          <div className="chat-mention-popup__empty">No results found</div>
        ) : (
          CATEGORY_ORDER.map((category) => {
            const items = results[category];
            if (!items || items.length === 0) return null;
            const Icon = typeIcons[category];

            return (
              <div key={category} className="chat-mention-popup__category">
                <div className="chat-mention-popup__category-header">
                  <Icon size={12} />
                  <span>{typeLabels[category]}</span>
                </div>
                {items.map((item) => {
                  const itemIndex = flatIndex++;
                  const isSelected = itemIndex === selectedIndex;
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      type="button"
                      className={`chat-mention-popup__item ${isSelected ? 'chat-mention-popup__item--selected' : ''}`}
                      data-selected={isSelected}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(item);
                      }}
                      onMouseEnter={() => setSelectedIndex(itemIndex)}
                    >
                      <span className="chat-mention-popup__item-name">{item.displayName}</span>
                      {item.secondaryText && (
                        <span className="chat-mention-popup__item-secondary">
                          {item.secondaryText}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    );
  },
);
