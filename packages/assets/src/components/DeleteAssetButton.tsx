'use client';

import { useState, useTransition, useCallback } from 'react';
import type { ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { deleteAsset } from '../actions/assetActions';
import { preCheckDeletion } from '@alga-psa/core';
import type { DeletionValidationResult } from '@alga-psa/types';

type ButtonProps = ComponentProps<typeof Button>;

interface DeleteAssetButtonProps {
  assetId: string;
  assetName?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  redirectTo?: string;
  onDeleted?: () => void | Promise<void>;
  label?: string;
}

export default function DeleteAssetButton({
  assetId,
  assetName,
  variant = 'destructive',
  size = 'sm',
  className,
  redirectTo,
  onDeleted,
  label = 'Delete'
}: DeleteAssetButtonProps) {
  const router = useRouter();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const resetDeleteState = () => {
    setIsDialogOpen(false);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
  };

  const runDeleteValidation = useCallback(async () => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('asset', assetId);
      setDeleteValidation(result);
    } catch (error) {
      console.error('Failed to validate asset deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: 'Failed to validate deletion. Please try again.',
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [assetId]);

  const handleConfirm = async () => {
    startTransition(async () => {
      try {
        setIsDeleteProcessing(true);
        const result = await deleteAsset(assetId);
        if (!result.success) {
          setDeleteValidation(result);
          return;
        }
        if (onDeleted) {
          await onDeleted();
        }
        resetDeleteState();
        if (redirectTo) {
          router.push(redirectTo);
        } else {
          router.refresh();
        }
      } catch (err) {
        console.error('Failed to delete asset:', err);
        setDeleteValidation({
          canDelete: false,
          code: 'VALIDATION_FAILED',
          message: 'Failed to delete asset. Please try again.',
          dependencies: [],
          alternatives: []
        });
      } finally {
        setIsDeleteProcessing(false);
      }
    });
  };

  return (
    <>
      <Button
        id={`delete-asset-${assetId}`}
        variant={variant}
        size={size}
        className={className}
        onClick={() => {
          setIsDialogOpen(true);
          void runDeleteValidation();
        }}
        disabled={isPending}
      >
        <Trash2 className="h-4 w-4" />
        <span>{isPending ? 'Removing…' : label}</span>
      </Button>

      <DeleteEntityDialog
        id={`delete-asset-dialog-${assetId}`}
        isOpen={isDialogOpen}
        onClose={resetDeleteState}
        onConfirmDelete={handleConfirm}
        entityName={assetName ?? 'this asset'}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing || isPending}
      />
    </>
  );
}
