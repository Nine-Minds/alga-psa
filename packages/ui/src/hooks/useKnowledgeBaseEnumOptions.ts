'use client';

import { useTranslation } from '../lib/i18n/client';
import {
  ARTICLE_AUDIENCE_LABEL_DEFAULTS,
  ARTICLE_AUDIENCE_VALUES,
  ARTICLE_STATUS_LABEL_DEFAULTS,
  ARTICLE_STATUS_VALUES,
  ARTICLE_TYPE_LABEL_DEFAULTS,
  ARTICLE_TYPE_VALUES,
  type ArticleAudience,
  type ArticleStatus,
  type ArticleType,
} from '@alga-psa/types';

const KB_NAMESPACE_DEFAULT = 'msp/knowledge-base';

export interface KbEnumOption<V extends string> {
  value: V;
  label: string;
}

export function useArticleStatusOptions(
  namespace: string = KB_NAMESPACE_DEFAULT,
): KbEnumOption<ArticleStatus>[] {
  const { t } = useTranslation(namespace);
  return ARTICLE_STATUS_VALUES.map((value) => ({
    value,
    label: t(`shared.statusLabels.${value}`, {
      defaultValue: ARTICLE_STATUS_LABEL_DEFAULTS[value],
    }),
  }));
}

export function useFormatArticleStatus(
  namespace: string = KB_NAMESPACE_DEFAULT,
): (value: string) => string {
  const { t } = useTranslation(namespace);
  return (value: string) => {
    const fallback =
      ARTICLE_STATUS_LABEL_DEFAULTS[value as ArticleStatus] ?? value;
    return t(`shared.statusLabels.${value}`, { defaultValue: fallback });
  };
}

export function useArticleAudienceOptions(
  namespace: string = KB_NAMESPACE_DEFAULT,
): KbEnumOption<ArticleAudience>[] {
  const { t } = useTranslation(namespace);
  return ARTICLE_AUDIENCE_VALUES.map((value) => ({
    value,
    label: t(`shared.audienceLabels.${value}`, {
      defaultValue: ARTICLE_AUDIENCE_LABEL_DEFAULTS[value],
    }),
  }));
}

export function useFormatArticleAudience(
  namespace: string = KB_NAMESPACE_DEFAULT,
): (value: string) => string {
  const { t } = useTranslation(namespace);
  return (value: string) => {
    const fallback =
      ARTICLE_AUDIENCE_LABEL_DEFAULTS[value as ArticleAudience] ?? value;
    return t(`shared.audienceLabels.${value}`, { defaultValue: fallback });
  };
}

export function useArticleTypeOptions(
  namespace: string = KB_NAMESPACE_DEFAULT,
): KbEnumOption<ArticleType>[] {
  const { t } = useTranslation(namespace);
  return ARTICLE_TYPE_VALUES.map((value) => ({
    value,
    label: t(`shared.typeLabels.${value}`, {
      defaultValue: ARTICLE_TYPE_LABEL_DEFAULTS[value],
    }),
  }));
}

export function useFormatArticleType(
  namespace: string = KB_NAMESPACE_DEFAULT,
): (value: string) => string {
  const { t } = useTranslation(namespace);
  return (value: string) => {
    const fallback =
      ARTICLE_TYPE_LABEL_DEFAULTS[value as ArticleType] ?? value;
    return t(`shared.typeLabels.${value}`, { defaultValue: fallback });
  };
}
