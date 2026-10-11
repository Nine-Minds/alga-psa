import { v4 as uuidv4 } from 'uuid';
import type { ContractWizardFixedLine } from '@alga-psa/types';
import { projectFixedServicesForSubmission } from './contractAuthoringSubmission';

/** A fresh, untouched fixed line (what a new wizard starts with). */
export function createEmptyFixedLine(enableProration = true): ContractWizardFixedLine {
  return {
    line_key: uuidv4(),
    enable_proration: enableProration,
    base_rate: null,
    services: [],
  };
}

/**
 * True for a line the author has not touched: no services (selected or not),
 * no base rate and no name. Blank lines are the wizard's starting placeholder
 * and are neither validated nor submitted.
 */
export function isBlankFixedLine(line: ContractWizardFixedLine): boolean {
  return (
    line.services.length === 0 &&
    !line.base_rate &&
    !(line.contract_line_name ?? '').trim() &&
    !(line.description ?? '').trim()
  );
}

/** Lines that carry authoring intent (everything except untouched placeholders). */
export function meaningfulFixedLines(lines: readonly ContractWizardFixedLine[]): ContractWizardFixedLine[] {
  return lines.filter((line) => !isBlankFixedLine(line));
}

/** A line with a recurring amount but no selected service cannot be billed. */
export function isServicelessFixedLine(line: ContractWizardFixedLine): boolean {
  return !line.services.some((service) => service.service_id) && !isBlankFixedLine(line);
}

/**
 * Projects wizard lines onto the persisted submission shape. Blank
 * placeholders and unselected service rows are dropped, and draft-only
 * authoring metadata (resolved catalog rate/source) never reaches the server.
 */
export function projectFixedLinesForSubmission(
  lines: readonly ContractWizardFixedLine[],
): ContractWizardFixedLine[] {
  return meaningfulFixedLines(lines).map((line) => ({
    line_key: line.line_key,
    source_contract_line_id: line.source_contract_line_id,
    contract_line_name: line.contract_line_name?.trim() || undefined,
    description: line.description,
    location_id: line.location_id,
    billing_frequency: line.billing_frequency,
    billing_timing: line.billing_timing,
    enable_proration: line.enable_proration,
    base_rate: line.base_rate ?? null,
    services: projectFixedServicesForSubmission(line.services.filter((service) => service.service_id)),
  }));
}
