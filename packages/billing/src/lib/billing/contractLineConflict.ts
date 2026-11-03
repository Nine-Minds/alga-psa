// Not a 'use server' module: 'use server' files may only export async functions,
// and this is a synchronous type guard used by both the action and the editor.
import type { ContractLineConflict } from '../../actions/contractLineSaveAction';

export const isContractLineConflict = (value: unknown): value is ContractLineConflict =>
  typeof value === 'object' && value !== null && (value as { status?: unknown }).status === 'contract-line-conflict';
