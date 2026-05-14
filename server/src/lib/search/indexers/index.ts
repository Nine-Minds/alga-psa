import type { EntityIndexer } from '../types';

import { assetIndexer } from './asset';
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
import { serviceCatalogIndexer } from './service_catalog';
import { serviceRequestDefinitionIndexer } from './service_request_definition';
import { serviceRequestSubmissionIndexer } from './service_request_submission';
import { ticketCommentIndexer } from './ticket_comment';
import { ticketIndexer } from './ticket';
import { userIndexer } from './user';
import { workflowTaskIndexer } from './workflow_task';

export const ceIndexers: EntityIndexer[] = [
  assetIndexer,
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
  userIndexer,
  ticketIndexer,
  ticketCommentIndexer,
  projectIndexer,
  projectPhaseIndexer,
  projectTaskIndexer,
  projectTaskCommentIndexer,
  workflowTaskIndexer,
];
