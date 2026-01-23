'use client';

import { useState, useTransition } from 'react';
import type { ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { deleteAsset } from '../actions/assetActions';

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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleConfirm = async () => {
    startTransition(async () => {
      try {
        await deleteAsset(assetId);
        if (onDeleted) {
          await onDeleted();
        }
        setIsDialogOpen(false);
        setError(null);
        if (redirectTo) {
          router.push(redirectTo);
        } else {
          router.refresh();
        }
      } catch (err) {
        console.error('Failed to delete asset:', err);
        setError('Failed to delete asset. Please try again.');
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
        onClick={() => setIsDialogOpen(true)}
        disabled={isPending}
      >
        <Trash2 className="h-4 w-4" />
        <span>{isPending ? 'Removing…' : label}</span>
      </Button>

      <ConfirmationDialog
        id={`delete-asset-dialog-${assetId}`}
        isOpen={isDialogOpen}
        onClose={() => {
          if (!isPending) {
            setIsDialogOpen(false);
            setError(null);
          }
        }}
        onConfirm={handleConfirm}
        title="Delete Asset"
        message={
          error ??
          `This will permanently delete ${assetName ?? 'this asset'} and remove all related schedules, documents, and history.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isConfirming={isPending}
      />
    </>
  );
}
