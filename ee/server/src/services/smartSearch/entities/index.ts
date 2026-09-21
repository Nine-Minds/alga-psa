/**
 * Registry of entities that offer smart search, keyed by the name in the route
 * path (`/api/smart-search/<entity>/stream`).
 */

import type { SmartSearchEntity } from '@alga-psa/ui/lib/smartSearch/types';

import type { AnySmartSearchEntityDefinition } from '../entityDefinition';
import { projectSmartSearch } from './project';
import { ticketSmartSearch } from './ticket';

const REGISTRY: Record<SmartSearchEntity, AnySmartSearchEntityDefinition> = {
  ticket: ticketSmartSearch as AnySmartSearchEntityDefinition,
  project: projectSmartSearch as AnySmartSearchEntityDefinition,
};

export function getSmartSearchEntity(entity: SmartSearchEntity): AnySmartSearchEntityDefinition {
  return REGISTRY[entity];
}
