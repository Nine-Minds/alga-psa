'use client';

import React, { useMemo } from 'react';
import { ITicketCategory } from '../../interfaces/ticket.interfaces';
import TreeSelect, { TreeSelectOption, TreeSelectPath } from '../ui/TreeSelect';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { FormFieldComponent } from '../../types/ui-reflection/types';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';

interface CategoryPickerProps {
  id?: string; // Made required since it's needed for reflection registration
  categories: ITicketCategory[];
  selectedCategories: string[];
  excludedCategories?: string[];
  onSelect: (categoryIds: string[], excludedIds: string[]) => void;
  placeholder?: string;
  multiSelect?: boolean;
  className?: string;
  containerClassName?: string;
  showExclude?: boolean;
  showReset?: boolean;
  allowEmpty?: boolean;
}

type CategoryType = 'parent' | 'child';

export const CategoryPicker: React.FC<CategoryPickerProps> = ({
  id = 'category-picker',
  categories,
  selectedCategories,
  excludedCategories = [],
  onSelect,
  placeholder = 'Select categories...',
  multiSelect = false,
  className = '',
  showExclude = false,
  showReset = false,
  allowEmpty = false,
}) => {
  // Register components with UI reflection system
  const { automationIdProps: containerProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    id,
    type: 'formField',
    fieldType: 'select',
    // value: selectedCategories.join(','),
    // label: placeholder
  });

  // const { automationIdProps: selectProps } = useAutomationIdAndRegister<FormFieldComponent>({
  //   id: `${id}-select`,
  //   type: 'formField',
  //   fieldType: 'select',
  //   value: selectedCategories.join(','),
  //   label: 'Category Select'
  // });

  // Transform categories into TreeSelect format
  const treeOptions = useMemo((): TreeSelectOption<CategoryType>[] => {
    // First, separate parents and children
    const parentCategories = categories.filter(c => !c.parent_category);
    const childrenMap = new Map<string, ITicketCategory[]>();
    
    // Group children by parent
    categories.filter(c => c.parent_category).forEach((child: ITicketCategory): void => {
      if (!childrenMap.has(child.parent_category!)) {
        childrenMap.set(child.parent_category!, []);
      }
      childrenMap.get(child.parent_category!)?.push(child);
    });

    // Transform into tree structure with selected and excluded states
    const categoryOptions = parentCategories.map((parent: ITicketCategory): TreeSelectOption<CategoryType> => ({
      label: parent.category_name,
      value: parent.category_id,
      type: 'parent' as CategoryType,
      selected: selectedCategories.includes(parent.category_id),
      excluded: excludedCategories.includes(parent.category_id),
      children: childrenMap.get(parent.category_id)?.map((child: ITicketCategory): TreeSelectOption<CategoryType> => ({
        label: child.category_name,
        value: child.category_id,
        type: 'child' as CategoryType,
        selected: selectedCategories.includes(child.category_id),
        excluded: excludedCategories.includes(child.category_id),
      })) || undefined
    }));

    // Add "No Category" option at the beginning
    return [
      {
        label: 'No Category',
        value: 'no-category',
        type: 'parent' as CategoryType,
        selected: selectedCategories.includes('no-category'),
        excluded: excludedCategories.includes('no-category'),
      },
      ...categoryOptions
    ];
  }, [categories, selectedCategories, excludedCategories]);

  // Handle selection changes
  const handleValueChange = (value: string, type: CategoryType, excluded: boolean, path?: TreeSelectPath) => {
    // Handle reset action
    if (value === '') {
      onSelect([], []); // Clear both selected and excluded categories
      return;
    }

    if (value === 'no-category') {
      // Handle "No Category" selection
      if (excluded) {
        // Toggle exclusion of "No Category"
        const newExcluded = excludedCategories.includes(value)
          ? excludedCategories.filter(id => id !== value)
          : [...excludedCategories, value];
        onSelect(selectedCategories, newExcluded);
      } else {
        // Select "No Category"
        onSelect([value], []);
      }
      return;
    }

    // Find the selected category
    const selectedCategory = categories.find(c => c.category_id === value);
    if (!selectedCategory) return;

    if (excluded) {
      // Handle exclusion toggle
      if (excludedCategories.includes(value)) {
        // Remove from exclusions
        onSelect(selectedCategories, excludedCategories.filter(id => id !== value));
      } else {
        // Add to exclusions and remove from selections if present
        onSelect(
          selectedCategories.filter(id => id !== value),
          [...excludedCategories, value]
        );
      }
    } else {
      // Handle selection
      if (multiSelect) {
        if (selectedCategories.includes(value)) {
          // Remove from selection
          onSelect(
            selectedCategories.filter(id => id !== value),
            excludedCategories
          );
        } else {
          // Add to selection and remove from exclusions if present
          onSelect(
            [...selectedCategories, value],
            excludedCategories.filter(id => id !== value)
          );
        }
      } else {
        // Single select mode
        onSelect([value], []);
      }
    }

    // Update UI reflection state
    updateMetadata({ value: selectedCategories.join(',') });
  };

  // Update display label to show both selected and excluded categories
  const currentValue = selectedCategories[0] || '';
  const displayLabel = useMemo(() => {
    const parts = [];
    
    if (selectedCategories.length > 0) {
      if (selectedCategories.length === 1) {
        const selectedId = selectedCategories[0];
        if (selectedId === 'no-category') {
          parts.push('No Category');
        } else {
          const selectedCategory = categories.find(c => c.category_id === selectedId);
          if (selectedCategory) {
            if (selectedCategory.parent_category) {
              // If it's a subcategory, show parent → child format
              const parentCategory = categories.find(c => c.category_id === selectedCategory.parent_category);
              if (parentCategory) {
                parts.push(`${parentCategory.category_name} → ${selectedCategory.category_name}`);
              } else {
                parts.push(selectedCategory.category_name);
              }
            } else {
              parts.push(selectedCategory.category_name);
            }
          }
        }
      } else {
        parts.push(`${selectedCategories.length} categories`);
      }
    }
    
    if (excludedCategories.length > 0) {
      if (excludedCategories.length === 1) {
        const excludedId = excludedCategories[0];
        if (excludedId === 'no-category') {
          parts.push('excluding No Category');
        } else {
          const excludedCategory = categories.find(c => c.category_id === excludedId);
          if (excludedCategory) {
            if (excludedCategory.parent_category) {
              // If it's a subcategory, show parent → child format
              const parentCategory = categories.find(c => c.category_id === excludedCategory.parent_category);
              if (parentCategory) {
                parts.push(`excluding ${parentCategory.category_name} → ${excludedCategory.category_name}`);
              } else {
                parts.push(`excluding ${excludedCategory.category_name}`);
              }
            } else {
              parts.push(`excluding ${excludedCategory.category_name}`);
            }
          }
        }
      } else {
        parts.push(`excluding ${excludedCategories.length} categories`);
      }
    }
    
    return parts.join(', ') || '';
  }, [selectedCategories, excludedCategories, categories]);

  return (
    <ReflectionContainer id={id} label="Category Picker">
      <div {...containerProps}>
        <TreeSelect
          // {...selectProps}
          options={treeOptions}
          value={currentValue}
          onValueChange={handleValueChange}
          placeholder={displayLabel || placeholder}
          className={className}
          selectedClassName="bg-gray-50"
          hoverClassName="hover:bg-gray-50"
          triggerClassName="hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          contentClassName="bg-white rounded-md shadow-lg border border-gray-200"
          multiSelect={multiSelect}
          showExclude={showExclude}
          showReset={showReset}
          allowEmpty={allowEmpty}
        />
      </div>
    </ReflectionContainer>
  );
};

export default CategoryPicker;
