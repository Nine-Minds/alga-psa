'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { createCategory, getAllBoards } from '@alga-psa/tickets/actions';
import type { IBoard, ITicketCategory } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface QuickAddCategoryProps {
  isOpen: boolean;
  onClose: () => void;
  onCategoryCreated: (category: ITicketCategory) => void;
  preselectedBoardId?: string;
  categories?: ITicketCategory[];
  boards?: IBoard[];
}

type QuickAddCategoryFormData = {
  category_name: string;
  board_id: string;
  parent_category: string;
};

const defaultFormData = (preselectedBoardId?: string): QuickAddCategoryFormData => ({
  category_name: '',
  board_id: preselectedBoardId || '',
  parent_category: '',
});

export default function QuickAddCategory({
  isOpen,
  onClose,
  onCategoryCreated,
  preselectedBoardId,
  categories = [],
  boards,
}: QuickAddCategoryProps) {
  const { t } = useTranslation('features/tickets');
  const [formData, setFormData] = useState<QuickAddCategoryFormData>(defaultFormData(preselectedBoardId));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fetchedBoards, setFetchedBoards] = useState<IBoard[]>([]);
  const [isLoadingBoards, setIsLoadingBoards] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setFormData(defaultFormData(preselectedBoardId));
      setError(null);
      setIsSubmitting(false);
      return;
    }

    setFormData((currentFormData) => ({
      ...currentFormData,
      board_id: preselectedBoardId || currentFormData.board_id,
    }));
    setError(null);
  }, [isOpen, preselectedBoardId]);

  useEffect(() => {
    if (!isOpen || boards) {
      return;
    }

    const loadBoards = async () => {
      try {
        setIsLoadingBoards(true);
        const allBoards = await getAllBoards();
        setFetchedBoards(Array.isArray(allBoards) ? allBoards : []);
      } catch (loadError) {
        console.error('Error fetching boards for QuickAddCategory:', loadError);
        setError(t('errors.loadBoardsFailed', 'Failed to load boards'));
      } finally {
        setIsLoadingBoards(false);
      }
    };

    void loadBoards();
  }, [boards, isOpen, t]);

  const availableBoards = useMemo(() => {
    const sourceBoards = boards || fetchedBoards;
    return sourceBoards.filter((board) => !board.is_inactive && board.category_type !== 'itil');
  }, [boards, fetchedBoards]);

  const resolvedBoardId = preselectedBoardId || formData.board_id;

  const parentCategoryOptions = useMemo(() => {
    const topLevelCategories = categories.filter((category) => !category.parent_category);
    const matchingCategories = resolvedBoardId
      ? topLevelCategories.filter((category) => category.board_id === resolvedBoardId)
      : topLevelCategories;

    return [
      { value: 'none', label: t('settings.categories.noneTopLevelCategory', 'None (Top-level category)') },
      ...matchingCategories.map((category) => ({
        value: category.category_id,
        label: resolvedBoardId
          ? category.category_name
          : `${category.category_name} (${availableBoards.find((board) => board.board_id === category.board_id)?.board_name || t('settings.categories.noBoard', 'No board')})`,
      })),
    ];
  }, [availableBoards, categories, resolvedBoardId, t]);

  useEffect(() => {
    if (!formData.parent_category) {
      return;
    }

    const parentCategory = categories.find((category) => category.category_id === formData.parent_category);
    if (!parentCategory) {
      setFormData((currentFormData) => ({
        ...currentFormData,
        parent_category: '',
      }));
      return;
    }

    const parentBoardId = parentCategory.board_id || '';
    if (resolvedBoardId && parentBoardId && parentBoardId !== resolvedBoardId) {
      setFormData((currentFormData) => ({
        ...currentFormData,
        parent_category: '',
      }));
      return;
    }

    if (!preselectedBoardId && parentBoardId && formData.board_id !== parentBoardId) {
      setFormData((currentFormData) => ({
        ...currentFormData,
        board_id: parentBoardId,
      }));
    }
  }, [categories, formData.board_id, formData.parent_category, preselectedBoardId, resolvedBoardId]);

  const handleClose = () => {
    setFormData(defaultFormData(preselectedBoardId));
    setError(null);
    setIsSubmitting(false);
    onClose();
  };

  const handleSubmit = async () => {
    const trimmedName = formData.category_name.trim();
    if (!trimmedName) {
      setError(t('validation.category.nameRequired', 'Category name is required'));
      return;
    }

    const parentCategory = formData.parent_category
      ? categories.find((category) => category.category_id === formData.parent_category)
      : undefined;
    const boardId = preselectedBoardId || parentCategory?.board_id || formData.board_id;

    if (!boardId) {
      setError(t('validation.category.boardRequiredForTopLevel', 'Board is required for top-level categories'));
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const createdCategory = await createCategory({
        category_name: trimmedName,
        display_order: 0,
        board_id: boardId,
        parent_category: formData.parent_category || undefined,
      });
      toast.success(t('settings.categories.createSuccess', 'Category created successfully'));
      onCategoryCreated(createdCategory);
      handleClose();
    } catch (submitError) {
      console.error('Error creating category:', submitError);
      setError(submitError instanceof Error ? submitError.message : t('errors.createCategoryFailed', 'Failed to create category'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const shouldShowBoardSelector = !preselectedBoardId && !formData.parent_category;

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title={t('settings.categories.addCategory', 'Add Category')}>
      <DialogContent>
        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div>
            <Label htmlFor="quick-add-category-name">
              {t('settings.categories.categoryName', 'Category Name *')}
            </Label>
            <Input
              id="quick-add-category-name"
              value={formData.category_name}
              onChange={(event) => {
                setFormData((currentFormData) => ({
                  ...currentFormData,
                  category_name: event.target.value,
                }));
              }}
              placeholder={t('settings.categories.enterCategoryName', 'Enter category name')}
            />
          </div>

          {shouldShowBoardSelector && (
            <div>
              <Label htmlFor="quick-add-category-board">{t('fields.board', 'Board')} *</Label>
              <CustomSelect
                value={formData.board_id}
                onValueChange={(value) => {
                  setFormData((currentFormData) => ({
                    ...currentFormData,
                    board_id: value,
                    parent_category: currentFormData.parent_category
                      ? (categories.find((category) => category.category_id === currentFormData.parent_category)?.board_id === value
                        ? currentFormData.parent_category
                        : '')
                      : '',
                  }));
                }}
                options={availableBoards.map((board) => ({
                  value: board.board_id || '',
                  label: board.board_name || '',
                }))}
                placeholder={isLoadingBoards
                  ? t('settings.categories.loadingBoards', 'Loading boards…')
                  : t('settings.categories.selectBoard', 'Select a board')}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('settings.categories.boardRequiredHelp', 'Required for top-level categories')}
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="quick-add-category-parent">
              {t('settings.categories.parentCategoryOptional', 'Parent Category (Optional)')}
            </Label>
            <CustomSelect
              value={formData.parent_category || 'none'}
              onValueChange={(value) => {
                const parentCategoryId = value === 'none' ? '' : value;
                const parentCategory = categories.find((category) => category.category_id === parentCategoryId);
                setFormData((currentFormData) => ({
                  ...currentFormData,
                  parent_category: parentCategoryId,
                  board_id: preselectedBoardId || parentCategory?.board_id || currentFormData.board_id,
                }));
              }}
              options={parentCategoryOptions}
              placeholder={t('settings.categories.selectParentCategory', 'Select parent category')}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {resolvedBoardId
                ? t(
                    'settings.categories.parentHelpWithBoard',
                    'Select a parent to create a subcategory, or leave empty for top-level'
                  )
                : t(
                    'settings.categories.parentHelpWithoutBoard',
                    'Select a board first, or pick a parent category to inherit its board'
                  )}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button id="quick-add-category-cancel" type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
            {t('actions.cancel', 'Cancel')}
          </Button>
          <Button id="quick-add-category-submit" type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting
              ? t('settings.categories.creating', 'Creating...')
              : t('actions.create', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
