import type { TabContent } from './CustomTabs';

const validTab: TabContent = {
  id: 'general',
  label: 'General',
  content: null,
};

// @ts-expect-error `id` is required for tab identity.
const missingId: TabContent = {
  label: 'General',
  content: null,
};

void validTab;
void missingId;
