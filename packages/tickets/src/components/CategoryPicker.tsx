'use client';

import React, { useMemo } from 'react';
import { ITicketCategory } from '@alga-psa/types';
import TreeSelect, { TreeSelectOption, TreeSelectPath } from '@alga-psa/ui/components/TreeSelect';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { AutomationProps, FormFieldComponent } from '@alga-psa/ui/ui-reflection/types';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';

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
  disabled?: boolean;
  modal?: boolean;
}

type CategoryType = 'parent' | 'child';

export const CategoryPicker: React.FC<CategoryPickerProps & AutomationProps> = ({
  id = 'category-picker',
  categories = [],
  selectedCategories = [],
  excludedCategories = [],
  onSelect,
  placeholder = 'Select categories...',
  multiSelect = false,
  className = '',
  showExclude = false,
  showReset = false,
  allowEmpty = false,
  disabled = false,
  modal = true,
  "data-automation-type": dataAutomationType = 'custom',
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
    // Ensure categories is an array - if it's not, return empty array
    if (!categories || !Array.isArray(categories)) {
      if (categories !== undefined && categories !== null) {
        console.error('CategoryPicker: categories prop is not an array:', categories);
      }
      return [{
        label: 'No Category',
        value: 'no-category',
        type: 'parent' as CategoryType,
        selected: Array.isArray(selectedCategories) ? selectedCategories.includes('no-category') : false,
        excluded: Array.isArray(excludedCategories) ? excludedCategories.includes('no-category') : false,
      }];
    }

    // Filter out any categories without proper names
    const validCategories = categories.filter(c => c && c.category_name && c.category_name.trim() !== '');

    // First, separate parents and children
    const parentCategories = validCategories.filter(c => !c.parent_category);
    const childrenMap = new Map<string, ITicketCategory[]>();
    
    // Group children by parent
    validCategories.filter(c => c.parent_category).forEach((child: ITicketCategory): void => {
      if (!childrenMap.has(child.parent_category!)) {
        childrenMap.set(child.parent_category!, []);
      }
      childrenMap.get(child.parent_category!)?.push(child);
    });

    // Transform into tree structure with selected and excluded states
    const categoryOptions = parentCategories.map((parent: ITicketCategory): TreeSelectOption<CategoryType> => ({
      label: parent.is_from_itil_standard ? (
        <span className="flex items-center gap-1">
          {parent.category_name}
          <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">ITIL</span>
        </span>
      ) : parent.category_name,
      value: parent.category_id,
      type: 'parent' as CategoryType,
      selected: selectedCategories.includes(parent.category_id),
      excluded: excludedCategories.includes(parent.category_id),
      children: childrenMap.get(parent.category_id)?.map((child: ITicketCategory): TreeSelectOption<CategoryType> => ({
        label: child.is_from_itil_standard ? (
          <span className="flex items-center gap-1">
            {child.category_name}
            <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">ITIL</span>
          </span>
        ) : child.category_name,
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
    let nextSelected = selectedCategories;
    let nextExcluded = excludedCategories;

    // Handle reset action
    if (value === '') {
      nextSelected = [];
      nextExcluded = [];
    } else if (value === 'no-category') {
      if (excluded) {
        nextExcluded = excludedCategories.includes(value)
          ? excludedCategories.filter(id => id !== value)
          : [...excludedCategories, value];
      } else {
        const isSelected = selectedCategories.includes(value);
        if (multiSelect) {
          nextSelected = isSelected
            ? selectedCategories.filter(id => id !== value)
            : [...selectedCategories.filter(id => id !== value), value];
        } else {
          nextSelected = isSelected ? [] : [value];
        }
        nextExcluded = excludedCategories.filter(id => id !== value);
      }
    } else {
      // Find the selected category
      const selectedCategory = categories.find(c => c.category_id === value);
      if (!selectedCategory) {
        return;
      }

      if (excluded) {
        nextExcluded = excludedCategories.includes(value)
          ? excludedCategories.filter(id => id !== value)
          : [...excludedCategories, value];
        nextSelected = selectedCategories.filter(id => id !== value);
      } else if (multiSelect) {
        nextSelected = selectedCategories.includes(value)
          ? selectedCategories.filter(id => id !== value)
          : [...selectedCategories, value];
        nextExcluded = excludedCategories.filter(id => id !== value);
      } else {
        nextSelected = [value];
        nextExcluded = [];
      }
    }

    onSelect(nextSelected, nextExcluded);
    updateMetadata({ value: nextSelected.join(',') });
  };

  // Update display label to show both selected and excluded categories
  const currentValue = selectedCategories[0] || '';
  const displayLabel = useMemo(() => {
    const parts: string[] = [];

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
          triggerClassName={`focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${!disabled ? 'hover:border-gray-400' : ''}`}
          contentClassName="bg-white rounded-md shadow-lg border border-gray-200"
          multiSelect={multiSelect}
          showExclude={showExclude}
          showReset={showReset}
          allowEmpty={allowEmpty}
          disabled={disabled}
          modal={modal}
        />
      </div>
    </ReflectionContainer>
  );
};

export default CategoryPicker;
