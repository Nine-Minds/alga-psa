'use client'

import React, { useState, useEffect } from 'react';
import { IInvoiceAnnotation } from '@alga-psa/types';
import { addInvoiceAnnotation, getInvoiceAnnotations } from '@alga-psa/billing/actions/invoiceTemplates';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface InvoiceAnnotationsProps {
  invoiceId: string;
}

const InvoiceAnnotations: React.FC<InvoiceAnnotationsProps> = ({ invoiceId }) => {
  const { t } = useTranslation('msp/invoicing');
  const [annotations, setAnnotations] = useState<IInvoiceAnnotation[]>([]);
  const [newAnnotation, setNewAnnotation] = useState('');
  const [highlightedAnnotationId, setHighlightedAnnotationId] = useState<string | null>(null);

  useEffect(() => {
    fetchAnnotations();
  }, [invoiceId]);

  const fetchAnnotations = async () => {
    const fetchedAnnotations = await getInvoiceAnnotations(invoiceId);
    setAnnotations(fetchedAnnotations);
  };

  const handleAddAnnotation = async () => {
    if (newAnnotation) {
      await addInvoiceAnnotation({
        invoice_id: invoiceId,
        user_id: 'current_user_id', // Replace with actual user ID
        content: newAnnotation,
        is_internal: true, // Or provide an option to toggle this
        created_at: new Date(),
      });
      fetchAnnotations();
      setNewAnnotation('');
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const annotationId = window.location.hash.startsWith('#annotation-')
      ? window.location.hash.slice('#annotation-'.length)
      : '';
    if (!annotationId || !annotations.some((annotation) => annotation.annotation_id === annotationId)) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`annotation-${annotationId}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedAnnotationId(annotationId);
    });
    const timeout = window.setTimeout(() => setHighlightedAnnotationId(null), 2000);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [annotations]);

  return (
    <div>
      <h3>{t('annotations.title', { defaultValue: 'Invoice Annotations' })}</h3>
      <ul>
        {annotations.map((annotation): React.JSX.Element => (
          <li
            key={annotation.annotation_id}
            id={`annotation-${annotation.annotation_id}`}
            className={highlightedAnnotationId === annotation.annotation_id
              ? 'search-highlight rounded ring-2 ring-yellow-400 bg-yellow-50'
              : undefined}
          >
            {annotation.content} - {annotation.is_internal
              ? t('annotations.labels.internal', { defaultValue: 'Internal' })
              : t('annotations.labels.external', { defaultValue: 'External' })}
          </li>
        ))}
      </ul>
      <div>
        <textarea
          value={newAnnotation}
          onChange={(e) => setNewAnnotation(e.target.value)}
          placeholder={t('annotations.placeholder', { defaultValue: 'Add a new annotation' })}
        />
        <button onClick={handleAddAnnotation}>
          {t('annotations.actions.add', { defaultValue: 'Add Annotation' })}
        </button>
      </div>
    </div>
  );
};

export default InvoiceAnnotations;
