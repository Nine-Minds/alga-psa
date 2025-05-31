/**
 * Custom Page Extension Types
 */
import { ReactNode } from 'react';
import { CustomPageProps } from '../../types';

/**
 * Props for the PageRenderer component
 */
export interface PageRendererProps {
  extensionId: string;
  component: string;
  props: CustomPageProps;
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
}

/**
 * Extension page definition for internal use
 */
export interface ExtensionPage {
  extensionId: string;
  component: string;
  props: CustomPageProps;
}