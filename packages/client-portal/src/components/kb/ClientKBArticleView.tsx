'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { toast } from 'react-hot-toast';
import { formatDate } from '@alga-psa/core/formatters';
import {
  ArrowLeft,
  BookOpen,
  HelpCircle,
  Wrench,
  FileText,
  ThumbsUp,
  ThumbsDown,
  Eye,
  Calendar,
  Check,
} from 'lucide-react';
import {
  getClientKBArticle,
  recordClientKBFeedback,
} from '../../actions/client-portal-actions/client-kb';
import type { IKBArticleWithDocument, ArticleType } from '@alga-psa/types';

const TYPE_ICONS: Record<ArticleType, React.ReactNode> = {
  how_to: <BookOpen className="w-5 h-5 text-blue-500" />,
  faq: <HelpCircle className="w-5 h-5 text-purple-500" />,
  troubleshooting: <Wrench className="w-5 h-5 text-orange-500" />,
  reference: <FileText className="w-5 h-5 text-gray-500" />,
};

const TYPE_LABELS: Record<ArticleType, string> = {
  how_to: 'How-To Guide',
  faq: 'FAQ',
  troubleshooting: 'Troubleshooting',
  reference: 'Reference',
};

interface ClientKBArticleViewProps {
  articleIdOrSlug: string;
  onBack?: () => void;
}

export default function ClientKBArticleView({
  articleIdOrSlug,
  onBack,
}: ClientKBArticleViewProps) {
  const { t } = useTranslation('features/documents');
  const [article, setArticle] = useState<IKBArticleWithDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<'helpful' | 'not_helpful' | null>(
    null
  );
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  const loadArticle = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getClientKBArticle(articleIdOrSlug);
      setArticle(result);
    } catch (error) {
      console.error('Failed to load article:', error);
    } finally {
      setIsLoading(false);
    }
  }, [articleIdOrSlug]);

  useEffect(() => {
    loadArticle();
  }, [loadArticle]);

  const handleFeedback = async (helpful: boolean) => {
    if (!article || feedbackSubmitted) return;

    setIsSubmittingFeedback(true);
    try {
      await recordClientKBFeedback(article.article_id, helpful);
      setFeedbackSubmitted(helpful ? 'helpful' : 'not_helpful');
      toast.success(t('kb.feedbackThanks', 'Thank you for your feedback!'));
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      toast.error(t('kb.feedbackError', 'Failed to submit feedback'));
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const renderBlockContent = (blockContent: any): React.ReactNode => {
    if (!blockContent) {
      return (
        <p className="text-muted-foreground">
          {t('kb.noContent', 'No content available')}
        </p>
      );
    }

    // Parse block content if it's a string
    let blocks: any[];
    try {
      const parsed = typeof blockContent === 'string' ? JSON.parse(blockContent) : blockContent;
      // Handle ProseMirror doc wrapper: { type: 'doc', content: [...] }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.type === 'doc' && Array.isArray(parsed.content)) {
        blocks = parsed.content;
      } else if (Array.isArray(parsed)) {
        blocks = parsed;
      } else {
        return <p className="text-muted-foreground">{String(blockContent)}</p>;
      }
    } catch {
      return <p className="text-muted-foreground">{String(blockContent)}</p>;
    }

    // Simple TipTap/BlockNote JSON renderer
    const renderNode = (node: any, index: number): React.ReactNode => {
      const key = `node-${index}`;

      switch (node.type) {
        case 'paragraph':
          return (
            <p key={key} className="mb-4">
              {node.content?.map((child: any, i: number) => renderText(child, i)) || ''}
            </p>
          );
        case 'heading': {
          const level = node.attrs?.level || node.props?.level || 2;
          const headingElements = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' } as const;
          const tag = headingElements[level as keyof typeof headingElements] || 'h2';
          const headingClasses: Record<number, string> = {
            1: 'text-2xl font-bold mb-4 mt-6',
            2: 'text-xl font-semibold mb-3 mt-5',
            3: 'text-lg font-medium mb-2 mt-4',
            4: 'text-base font-medium mb-2 mt-3',
          };
          const children = node.content?.map((child: any, i: number) => renderText(child, i)) || '';
          return React.createElement(tag, { key, className: headingClasses[level] || headingClasses[2] }, children);
        }
        case 'bulletList':
        case 'bullet_list':
          return (
            <ul key={key} className="list-disc list-inside mb-4 space-y-1">
              {node.content?.map((child: any, i: number) => renderNode(child, i)) || null}
            </ul>
          );
        case 'orderedList':
        case 'ordered_list':
          return (
            <ol key={key} className="list-decimal list-inside mb-4 space-y-1">
              {node.content?.map((child: any, i: number) => renderNode(child, i)) || null}
            </ol>
          );
        case 'listItem':
        case 'list_item':
          return (
            <li key={key}>
              {node.content?.map((child: any, i: number) => {
                if (child.type === 'paragraph') {
                  return child.content?.map((c: any, j: number) => renderText(c, j)) || null;
                }
                return renderNode(child, i);
              }) || null}
            </li>
          );
        case 'bulletListItem':
          return (
            <li key={key} className="list-disc list-inside mb-1">
              {node.content?.map((child: any, i: number) => renderText(child, i)) || null}
            </li>
          );
        case 'numberedListItem':
          return (
            <li key={key} className="list-decimal list-inside mb-1">
              {node.content?.map((child: any, i: number) => renderText(child, i)) || null}
            </li>
          );
        case 'blockquote':
          return (
            <blockquote
              key={key}
              className="border-l-4 border-primary/30 pl-4 italic my-4 text-muted-foreground"
            >
              {node.content?.map((child: any, i: number) => {
                // BlockNote format: inline text nodes directly in content
                if (child.type === 'text') return renderText(child, i);
                // ProseMirror format: block nodes (paragraph, etc.) in content
                return renderNode(child, i);
              }) || null}
            </blockquote>
          );
        case 'codeBlock':
        case 'code_block':
          return (
            <pre
              key={key}
              className="bg-muted rounded-lg p-4 overflow-x-auto my-4 text-sm font-mono"
            >
              <code>
                {node.content?.map((child: any, i: number) => renderText(child, i)) || ''}
              </code>
            </pre>
          );
        case 'horizontalRule':
          return <hr key={key} className="my-6 border-t border-border" />;
        default:
          // Unknown type - try to render content if available
          if (node.content) {
            return (
              <div key={key}>
                {node.content.map((child: any, i: number) => renderNode(child, i))}
              </div>
            );
          }
          return null;
      }
    };

    // Parse raw markdown inline formatting within a text string
    const renderInlineMarkdown = (rawText: string, baseKey: string): React.ReactNode[] => {
      const segments: React.ReactNode[] = [];
      // Match **bold**, *italic*, `code`, and [text](url)
      const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let matchIndex = 0;

      while ((match = regex.exec(rawText)) !== null) {
        if (match.index > lastIndex) {
          segments.push(<React.Fragment key={`${baseKey}-t-${matchIndex}`}>{rawText.slice(lastIndex, match.index)}</React.Fragment>);
        }
        if (match[2]) {
          segments.push(<strong key={`${baseKey}-b-${matchIndex}`}>{match[2]}</strong>);
        } else if (match[3]) {
          segments.push(<em key={`${baseKey}-i-${matchIndex}`}>{match[3]}</em>);
        } else if (match[4]) {
          segments.push(<code key={`${baseKey}-c-${matchIndex}`} className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">{match[4]}</code>);
        } else if (match[5] && match[6]) {
          const safeHref = /^https?:/i.test(match[6]) ? match[6] : '#';
          segments.push(
            <a key={`${baseKey}-a-${matchIndex}`} href={safeHref} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{match[5]}</a>
          );
        }
        lastIndex = match.index + match[0].length;
        matchIndex++;
      }

      if (lastIndex < rawText.length) {
        segments.push(<React.Fragment key={`${baseKey}-t-${matchIndex}`}>{rawText.slice(lastIndex)}</React.Fragment>);
      }

      return segments.length > 0 ? segments : [<React.Fragment key={`${baseKey}-raw`}>{rawText}</React.Fragment>];
    };

    const renderText = (node: any, index: number): React.ReactNode => {
      if (node.type === 'text') {
        let text: React.ReactNode = node.text || '';
        let hasFormatting = false;

        // Handle BlockNote styles format
        if (node.styles && typeof node.styles === 'object') {
          if (node.styles.bold) {
            text = <strong key={`bold-${index}`}>{text}</strong>;
            hasFormatting = true;
          }
          if (node.styles.italic) {
            text = <em key={`italic-${index}`}>{text}</em>;
            hasFormatting = true;
          }
          if (node.styles.underline) {
            text = <span key={`underline-${index}`} className="underline">{text}</span>;
            hasFormatting = true;
          }
          if (node.styles.code) {
            text = <code key={`code-${index}`} className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">{text}</code>;
            hasFormatting = true;
          }
          if (node.styles.strike) {
            text = <s key={`strike-${index}`}>{text}</s>;
            hasFormatting = true;
          }
          const linkStyle = node.styles.link;
          if (linkStyle) {
            const rawHref = typeof linkStyle === 'string' ? linkStyle : linkStyle?.href || linkStyle?.url || '';
            const safeHref = /^(https?:|mailto:)/i.test(rawHref) ? rawHref : '#';
            text = <a key={`link-${index}`} href={safeHref} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{text}</a>;
            hasFormatting = true;
          }
        }

        // Handle ProseMirror marks format
        if (node.marks) {
          for (const mark of node.marks) {
            hasFormatting = true;
            switch (mark.type) {
              case 'bold':
                text = <strong key={`bold-${index}`}>{text}</strong>;
                break;
              case 'italic':
                text = <em key={`italic-${index}`}>{text}</em>;
                break;
              case 'underline':
                text = (
                  <span key={`underline-${index}`} className="underline">
                    {text}
                  </span>
                );
                break;
              case 'code':
                text = (
                  <code
                    key={`code-${index}`}
                    className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono"
                  >
                    {text}
                  </code>
                );
                break;
              case 'link': {
                const rawHref = mark.attrs?.href || '';
                const safeHref = /^(https?:|mailto:)/i.test(rawHref) ? rawHref : '#';
                text = (
                  <a
                    key={`link-${index}`}
                    href={safeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {text}
                  </a>
                );
                break;
              }
            }
          }
        }

        // Fallback: if no formatting was applied and text contains raw markdown
        // syntax, parse it inline
        if (!hasFormatting && typeof node.text === 'string' && /\*\*|`|\[.+\]\(https?:/.test(node.text)) {
          return <React.Fragment key={index}>{renderInlineMarkdown(node.text, `md-${index}`)}</React.Fragment>;
        }

        return <React.Fragment key={index}>{text}</React.Fragment>;
      }

      // Handle nested nodes
      return renderNode(node, index);
    };

    return (
      <div className="prose prose-sm max-w-none dark:prose-invert">
        {blocks.map((block, index) => renderNode(block, index))}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="sm" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="text-center py-12">
        <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <p className="text-muted-foreground mb-4">
          {t('kb.articleNotFound', 'Article not found')}
        </p>
        {onBack && (
          <Button id="kb-article-back" variant="outline" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('kb.backToArticles', 'Back to Articles')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back Button */}
      {onBack && (
        <Button id="kb-article-back-mobile" variant="ghost" size="sm" onClick={onBack} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t('kb.backToArticles', 'Back to Articles')}
        </Button>
      )}

      {/* Article Header */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 p-3 bg-muted rounded-lg">
              {TYPE_ICONS[article.article_type] || <FileText className="w-6 h-6" />}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold mb-2">
                {article.document_name || article.slug}
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <Badge variant="secondary">
                  {TYPE_LABELS[article.article_type]}
                </Badge>
                <span className="flex items-center gap-1">
                  <Eye className="w-4 h-4" />
                  {article.view_count} {t('kb.views', 'views')}
                </span>
                {article.published_at && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {formatDate(article.published_at)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Article Content */}
      <Card className="mb-6">
        <CardContent className="p-6">
          {renderBlockContent((article as any).block_data)}
        </CardContent>
      </Card>

      {/* Feedback Section */}
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <h3 className="text-lg font-medium mb-2">
              {t('kb.wasHelpful', 'Was this article helpful?')}
            </h3>
            {feedbackSubmitted ? (
              <div className="flex items-center justify-center gap-2 text-green-600">
                <Check className="w-5 h-5" />
                <span>{t('kb.feedbackThanks', 'Thank you for your feedback!')}</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-4">
                <Button
                  id="kb-article-helpful"
                  variant="outline"
                  onClick={() => handleFeedback(true)}
                  disabled={isSubmittingFeedback}
                  className="min-w-24"
                >
                  <ThumbsUp className="w-4 h-4 mr-2" />
                  {t('kb.yes', 'Yes')}
                  <span className="ml-2 text-muted-foreground">
                    ({article.helpful_count})
                  </span>
                </Button>
                <Button
                  id="kb-article-not-helpful"
                  variant="outline"
                  onClick={() => handleFeedback(false)}
                  disabled={isSubmittingFeedback}
                  className="min-w-24"
                >
                  <ThumbsDown className="w-4 h-4 mr-2" />
                  {t('kb.no', 'No')}
                  <span className="ml-2 text-muted-foreground">
                    ({article.not_helpful_count})
                  </span>
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
