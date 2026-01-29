'use client';

import React from 'react';
import styles from '../editor/TicketDetails.module.css';

interface ContentCardProps {
  id?: string;
  children: React.ReactNode;
  className?: string;
}

interface ContentCardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * A consistent white card container used across the application.
 * Use with ContentCard.Header for the title section.
 *
 * @example
 * <ContentCard>
 *   <ContentCard.Header>
 *     <Icon className="w-5 h-5 mr-2" />
 *     Card Title
 *   </ContentCard.Header>
 *   <div>Card content here</div>
 * </ContentCard>
 */
export function ContentCard({ id, children, className = '' }: ContentCardProps) {
  return (
    <div id={id} className={`${styles['card']} p-6 space-y-4 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Header component for ContentCard with consistent styling.
 */
function ContentCardHeader({ children, className = '' }: ContentCardHeaderProps) {
  return (
    <h2 className={`${styles['panel-header']} flex items-center ${className}`}>
      {children}
    </h2>
  );
}

ContentCard.Header = ContentCardHeader;

export default ContentCard;
