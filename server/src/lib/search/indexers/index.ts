import type { EntityIndexer } from '../types';

import { clientIndexer } from './client';
import { contactIndexer } from './contact';
import { ticketIndexer } from './ticket';
import { userIndexer } from './user';

export const ceIndexers: EntityIndexer[] = [clientIndexer, contactIndexer, userIndexer, ticketIndexer];
