'use client';

import * as React from 'react';
import { cn } from '../lib/utils';

export interface BreadcrumbItem {
  label: React.ReactNode;
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  separator?: React.ReactNode;
  className?: string;
  maxItems?: number;
}

function DefaultSeparator() {
  return (
    <span aria-hidden="true" className="text-muted-foreground mx-1.5">
      /
    </span>
  );
}

function BreadcrumbLink({
  item,
  isLast,
}: {
  item: BreadcrumbItem;
  isLast: boolean;
}) {
  const content = (
    <>
      {item.icon && <span className="mr-1 inline-flex items-center">{item.icon}</span>}
      {item.label}
    </>
  );

  if (isLast) {
    return (
      <span
        className="text-sm font-medium text-[rgb(var(--color-text-900))]"
        aria-current="page"
      >
        {content}
      </span>
    );
  }

  if (item.onClick) {
    return (
      <button
        type="button"
        onClick={item.onClick}
        className="text-sm text-muted-foreground hover:text-[rgb(var(--color-text-900))] transition-colors inline-flex items-center"
      >
        {content}
      </button>
    );
  }

  if (item.href) {
    return (
      <a
        href={item.href}
        className="text-sm text-muted-foreground hover:text-[rgb(var(--color-text-900))] transition-colors inline-flex items-center"
      >
        {content}
      </a>
    );
  }

  return (
    <span className="text-sm text-muted-foreground inline-flex items-center">
      {content}
    </span>
  );
}

function Breadcrumbs({ items, separator, className, maxItems }: BreadcrumbsProps) {
  const resolvedSeparator = separator ?? <DefaultSeparator />;

  let displayItems = items;

  if (maxItems != null && maxItems > 1 && items.length > maxItems) {
    const firstItem = items[0];
    const lastItems = items.slice(-(maxItems - 1));
    const ellipsisItem: BreadcrumbItem = { label: '\u2026' };
    displayItems = [firstItem, ellipsisItem, ...lastItems];
  }

  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center', className)}>
      <ol className="flex items-center flex-wrap">
        {displayItems.map((item, index) => {
          const isLast = index === displayItems.length - 1;
          return (
            <li key={index} className="inline-flex items-center">
              <BreadcrumbLink item={item} isLast={isLast} />
              {!isLast && resolvedSeparator}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export { Breadcrumbs };
