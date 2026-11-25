/**
 * The reader that turns a preset-copy refusal into a returned action error, in
 * its own module so every caller uses the SAME one: the standalone action
 * (`copyPresetToContractLine`) and the composite quick-add save
 * (`saveQuickAddContract`), which copies presets inside its own transaction.
 * Same refusal, same readable message, whichever path the user took.
 */

import { isContractLineTimingNotAllowedError } from '@shared/billingClients/contractLineTimingRule';
import {
    actionError,
    permissionError,
    type ActionMessageError,
    type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { ContractLinePresetDomainError } from '../services/contractLinePresetCopyService';

export type ContractLinePresetActionError = ActionMessageError | ActionPermissionError;

export function contractLinePresetActionErrorFrom(error: unknown): ContractLinePresetActionError | null {
    if (isContractLineTimingNotAllowedError(error)) {
        return actionError(error.message, 'msp/contract-lines:errors.line.advanceTimingNotAllowed');
    }

    if (error instanceof ContractLinePresetDomainError) {
        if (error.message.startsWith('Permission denied:')) {
            return permissionError(error.message);
        }
        return actionError(error.message);
    }

    if (error instanceof Error && error.message.startsWith('Permission denied:')) {
        return permissionError(error.message);
    }

    // Validation failures from the shared prepaid block config service.
    if (error instanceof Error && error.message.startsWith('Cannot save prepaid block')) {
        return actionError(error.message);
    }

    const dbError = error as { code?: string; column?: string; constraint?: string };
    if (dbError?.code === '22P02') {
        return actionError('One of the selected contract line preset values is invalid. Please refresh and try again.', 'msp/contract-lines:errors.preset.invalidValue');
    }
    if (dbError?.code === '23502') {
        return dbError.column
          ? actionError(
              `Missing required contract line preset field: ${dbError.column}.`,
              'msp/contract-lines:errors.preset.missingFieldNamed',
              { field: dbError.column },
            )
          : actionError('Missing required contract line preset field.', 'msp/contract-lines:errors.preset.missingField');
    }
    if (dbError?.code === '23503') {
        return actionError('The selected contract line preset, contract, or service no longer exists. Please refresh and try again.', 'msp/contract-lines:errors.preset.referenceMissing');
    }
    if (dbError?.code === '23505') {
        return actionError('This contract line preset change conflicts with an existing record. Please refresh and try again.', 'msp/contract-lines:errors.preset.conflict');
    }
    if (dbError?.code === '23514') {
        return actionError('One of the contract line preset values is not allowed. Please review the form and try again.', 'msp/contract-lines:errors.preset.notAllowed');
    }

    return null;
}
