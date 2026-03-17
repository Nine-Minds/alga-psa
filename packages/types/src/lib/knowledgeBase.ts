import type { IDocument } from '../interfaces/document.interface';

export type ArticleType = 'how_to' | 'faq' | 'troubleshooting' | 'reference';
export type ArticleAudience = 'internal' | 'client' | 'public';
export type ArticleStatus = 'draft' | 'review' | 'published' | 'archived';
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested';

export interface IKBArticle {
  article_id: string;
  tenant: string;
  document_id: string;
  slug: string;
  article_type: ArticleType;
  audience: ArticleAudience;
  status: ArticleStatus;
  next_review_due: Date | null;
  review_cycle_days: number | null;
  last_reviewed_at: Date | null;
  last_reviewed_by: string | null;
  view_count: number;
  helpful_count: number;
  not_helpful_count: number;
  category_id: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
  published_at: Date | null;
  published_by: string | null;
}

export interface IKBArticleWithDocument extends IKBArticle {
  document?: IDocument;
  document_name?: string;
  block_data?: unknown;
}

export interface IKBArticleReviewer {
  reviewer_id: string;
  tenant: string;
  article_id: string;
  user_id: string;
  review_status: ReviewStatus;
  review_notes: string | null;
  assigned_at: Date;
  reviewed_at: Date | null;
  assigned_by: string | null;
}

export interface IKBArticleTemplate {
  template_id: string;
  tenant: string;
  name: string;
  description: string | null;
  article_type: ArticleType;
  content_template: any;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}
