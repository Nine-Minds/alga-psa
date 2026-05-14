import type { EntityIndexer } from '../types';

import { clientIndexer } from './client';
import { contactIndexer } from './contact';
import { ticketCommentIndexer } from './ticket_comment';
import { ticketIndexer } from './ticket';
import { userIndexer } from './user';

export const ceIndexers: EntityIndexer[] = [
  clientIndexer,
  contactIndexer,
  userIndexer,
  ticketIndexer,
  ticketCommentIndexer,
];
