import type { EntityIndexer } from '../types';

import { clientIndexer } from './client';
import { contactIndexer } from './contact';

export const ceIndexers: EntityIndexer[] = [clientIndexer, contactIndexer];
