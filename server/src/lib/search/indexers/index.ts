import type { EntityIndexer } from '../types';

import { assetIndexer } from './asset';
import { clientIndexer } from './client';
import { contactIndexer } from './contact';
import { invoiceIndexer } from './invoice';
import { projectPhaseIndexer } from './project_phase';
import { projectTaskCommentIndexer } from './project_task_comment';
import { projectTaskIndexer } from './project_task';
import { projectIndexer } from './project';
import { ticketCommentIndexer } from './ticket_comment';
import { ticketIndexer } from './ticket';
import { userIndexer } from './user';

export const ceIndexers: EntityIndexer[] = [
  assetIndexer,
  clientIndexer,
  contactIndexer,
  invoiceIndexer,
  userIndexer,
  ticketIndexer,
  ticketCommentIndexer,
  projectIndexer,
  projectPhaseIndexer,
  projectTaskIndexer,
  projectTaskCommentIndexer,
];
