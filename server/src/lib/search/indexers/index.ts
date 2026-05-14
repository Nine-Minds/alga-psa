import type { EntityIndexer } from '../types';

import { clientIndexer } from './client';

export const ceIndexers: EntityIndexer[] = [clientIndexer];
