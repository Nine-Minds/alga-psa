'use client';

import React, { useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Tag } from 'lucide-react';

interface Category {
  id: string;
  name: string;
  parent_id?: string | null;
  children?: Category[];
}

interface KBCategoryTreeProps {
  categories: Category[];
  selectedCategoryId?: string | null;
  onSelectCategory?: (categoryId: string | null) => void;
  showAllOption?: boolean;
  className?: string;
}

interface CategoryNodeProps {
  category: Category;
  level: number;
  selectedCategoryId?: string | null;
  onSelectCategory?: (categoryId: string | null) => void;
}

function CategoryNode({
  category,
  level,
  selectedCategoryId,
  onSelectCategory,
}: CategoryNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = category.children && category.children.length > 0;
  const isSelected = selectedCategoryId === category.id;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 px-2 rounded cursor-pointer transition-colors ${
          isSelected
            ? 'bg-primary/10 text-primary'
            : 'hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))]'
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelectCategory?.(category.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="p-0.5 hover:bg-gray-200 dark:hover:bg-[rgb(var(--color-border-200))] rounded"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}
        {isExpanded && hasChildren ? (
          <FolderOpen className="w-4 h-4 text-amber-500" />
        ) : hasChildren ? (
          <Folder className="w-4 h-4 text-amber-500" />
        ) : (
          <Tag className="w-4 h-4 text-gray-400" />
        )}
        <span className={`text-sm ${isSelected ? 'font-medium' : ''}`}>
          {category.name}
        </span>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {category.children!.map((child) => (
            <CategoryNode
              key={child.id}
              category={child}
              level={level + 1}
              selectedCategoryId={selectedCategoryId}
              onSelectCategory={onSelectCategory}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function KBCategoryTree({
  categories,
  selectedCategoryId,
  onSelectCategory,
  showAllOption = true,
  className = '',
}: KBCategoryTreeProps) {
  const { t } = useTranslation('features/documents');

  // Build tree structure from flat list
  const buildTree = (items: Category[]): Category[] => {
    const map = new Map<string, Category>();
    const roots: Category[] = [];

    // First pass: create a map of all items
    items.forEach((item) => {
      map.set(item.id, { ...item, children: [] });
    });

    // Second pass: build the tree
    items.forEach((item) => {
      const node = map.get(item.id)!;
      if (item.parent_id && map.has(item.parent_id)) {
        const parent = map.get(item.parent_id)!;
        parent.children = parent.children || [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  };

  const tree = buildTree(categories);

  return (
    <div className={`space-y-1 ${className}`}>
      {showAllOption && (
        <div
          className={`flex items-center gap-1 py-1.5 px-2 rounded cursor-pointer transition-colors ${
            selectedCategoryId === null
              ? 'bg-primary/10 text-primary'
              : 'hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))]'
          }`}
          onClick={() => onSelectCategory?.(null)}
        >
          <span className="w-4" />
          <Folder className="w-4 h-4 text-gray-400" />
          <span className={`text-sm ${selectedCategoryId === null ? 'font-medium' : ''}`}>
            {t('kb.allCategories', 'All Categories')}
          </span>
        </div>
      )}

      {tree.map((category) => (
        <CategoryNode
          key={category.id}
          category={category}
          level={0}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={onSelectCategory}
        />
      ))}

      {categories.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t('kb.noCategories', 'No categories defined')}
        </p>
      )}
    </div>
  );
}
