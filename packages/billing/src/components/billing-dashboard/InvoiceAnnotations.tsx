'use client'

import React, { useState, useEffect } from 'react';
import { IInvoiceAnnotation } from '@alga-psa/types';
import { addInvoiceAnnotation, getInvoiceAnnotations } from '@alga-psa/billing/actions/invoiceTemplates';

interface InvoiceAnnotationsProps {
  invoiceId: string;
}

const InvoiceAnnotations: React.FC<InvoiceAnnotationsProps> = ({ invoiceId }) => {
  const [annotations, setAnnotations] = useState<IInvoiceAnnotation[]>([]);
  const [newAnnotation, setNewAnnotation] = useState('');

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

  return (
    <div>
      <h3>Invoice Annotations</h3>
      <ul>
        {annotations.map((annotation): React.JSX.Element => (
          <li key={annotation.annotation_id}>
            {annotation.content} - {annotation.is_internal ? 'Internal' : 'External'}
          </li>
        ))}
      </ul>
      <div>
        <textarea
          value={newAnnotation}
          onChange={(e) => setNewAnnotation(e.target.value)}
          placeholder="Add a new annotation"
        />
        <button onClick={handleAddAnnotation}>Add Annotation</button>
      </div>
    </div>
  );
};

export default InvoiceAnnotations;
