import type { EntityIndexer } from '@alga-psa/types';

import { assetIndexer } from './asset';
import { boardIndexer } from './board';
import { categoryIndexer } from './category';
import { clientContractIndexer } from './client_contract';
import { clientIndexer } from './client';
import { contactIndexer } from './contact';
import { contractIndexer } from './contract';
import { documentIndexer } from './document';
import { interactionIndexer } from './interaction';
import { invoiceAnnotationIndexer } from './invoice_annotation';
import { invoiceItemIndexer } from './invoice_item';
import { invoiceIndexer } from './invoice';
import { kbArticleIndexer } from './kb_article';
import { projectPhaseIndexer } from './project_phase';
import { projectTaskCommentIndexer } from './project_task_comment';
import { projectTaskIndexer } from './project_task';
import { projectIndexer } from './project';
import { scheduleEntryIndexer } from './schedule_entry';
import { serviceCatalogIndexer } from './service_catalog';
import { serviceRequestDefinitionIndexer } from './service_request_definition';
import { serviceRequestSubmissionIndexer } from './service_request_submission';
import { statusIndexer } from './status';
import { tagIndexer } from './tag';
import { ticketCommentIndexer } from './ticket_comment';
import { ticketIndexer } from './ticket';
import { timeEntryIndexer } from './time_entry';
import { userIndexer } from './user';
import { workflowTaskIndexer } from './workflow_task';

export const ceIndexers: EntityIndexer[] = [
  assetIndexer,
  boardIndexer,
  categoryIndexer,
  clientContractIndexer,
  clientIndexer,
  contactIndexer,
  contractIndexer,
  documentIndexer,
  interactionIndexer,
  invoiceIndexer,
  invoiceItemIndexer,
  invoiceAnnotationIndexer,
  kbArticleIndexer,
  serviceCatalogIndexer,
  serviceRequestDefinitionIndexer,
  serviceRequestSubmissionIndexer,
  statusIndexer,
  tagIndexer,
  userIndexer,
  ticketIndexer,
  ticketCommentIndexer,
  projectIndexer,
  projectPhaseIndexer,
  projectTaskIndexer,
  projectTaskCommentIndexer,
  scheduleEntryIndexer,
  timeEntryIndexer,
  workflowTaskIndexer,
];
