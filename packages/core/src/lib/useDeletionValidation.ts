import { useCallback, useState } from 'react';
import type { DeletionValidationResult } from '@alga-psa/types';
import { preCheckDeletion } from '../server/deletion/deletionActions';

export function useDeletionValidation(entityType: string) {
  const [validationResult, setValidationResult] = useState<DeletionValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback(
    async (entityId: string) => {
      setIsValidating(true);
      setError(null);

      try {
        const result = await preCheckDeletion(entityType, entityId);
        setValidationResult(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to validate deletion.';
        setError(message);
        throw err;
      } finally {
        setIsValidating(false);
      }
    },
    [entityType]
  );

  const reset = useCallback(() => {
    setValidationResult(null);
    setIsValidating(false);
    setError(null);
  }, []);

  return {
    validate,
    reset,
    validationResult,
    isValidating,
    error,
    canDelete: validationResult?.canDelete ?? false
  };
}
