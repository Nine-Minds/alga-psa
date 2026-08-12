'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { IDocument, UpdateDocumentContentInput } from '@alga-psa/types';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Button } from '@alga-psa/ui/components/Button';
import { Text } from '@radix-ui/themes';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// Combined type for form data
interface DocumentFormData extends Omit<IDocument, 'document_id' | 'tenant'> {
    content: string;
}

interface DocumentFormProps {
    onSubmit: (data: {
        document: Partial<IDocument>;
        content: UpdateDocumentContentInput;
    }) => void;
}

const DocumentForm: React.FC<DocumentFormProps> = ({ onSubmit }) => {
    const { t } = useTranslation('features/documents');
    const { register, handleSubmit, formState: { errors } } = useForm<DocumentFormData>();
    const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

    // Same messages feed both the inline field errors and the summary alert.
    const requiredMessages = {
        documentName: t('validation.nameRequired', { defaultValue: 'Document name is required' }),
        documentType: t('validation.typeRequired', { defaultValue: 'Document type is required' }),
        userId: t('validation.userIdRequired', { defaultValue: 'User ID is required' }),
        orderNumber: t('validation.orderNumberRequired', { defaultValue: 'Order number is required' }),
        content: t('validation.contentRequired', { defaultValue: 'Content is required' }),
    };

    const handleFormSubmit = (data: DocumentFormData) => {
        setHasAttemptedSubmit(true);
        // Separate document and content data
        const { content, ...documentData } = data;
        
        onSubmit({
            document: documentData,
            content: {
                content,
                updated_by_id: documentData.user_id
            }
        });
    };

    const validationErrors: string[] = [];
    if (hasAttemptedSubmit) {
        if (errors.document_name) validationErrors.push(requiredMessages.documentName);
        if (errors.type_id) validationErrors.push(requiredMessages.documentType);
        if (errors.user_id) validationErrors.push(requiredMessages.userId);
        if (errors.order_number) validationErrors.push(requiredMessages.orderNumber);
        if (errors.content) validationErrors.push(requiredMessages.content);
    }

    return (
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4" noValidate>
            {hasAttemptedSubmit && validationErrors.length > 0 && (
                <Alert variant="destructive">
                    <AlertDescription>
                        {t('form.errorsHeading', { defaultValue: 'Please fix the following errors:' })}
                        <ul className="list-disc pl-5 mt-1 text-sm">
                            {validationErrors.map((err, index) => (
                                <li key={index}>{err}</li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            )}
            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    {t('form.fields.documentName', { defaultValue: 'Document Name *' })}
                </Text>
                <Input
                    id="document-name-input"
                    {...register('document_name', { required: requiredMessages.documentName })}
                    className={hasAttemptedSubmit && errors.document_name ? 'border-red-500' : ''}
                />
                {errors.document_name && (
                    <Text as="p" size="1" color="red" className="mt-1">
                        {errors.document_name.message}
                    </Text>
                )}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    {t('form.fields.documentType', { defaultValue: 'Document Type *' })}
                </Text>
                <Input
                    id="document-type-input"
                    {...register('type_id', { required: requiredMessages.documentType })}
                    className={hasAttemptedSubmit && errors.type_id ? 'border-red-500' : ''}
                />
                {errors.type_id && (
                    <Text as="p" size="1" color="red" className="mt-1">
                        {errors.type_id.message}
                    </Text>
                )}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    {t('form.fields.userId', { defaultValue: 'User ID *' })}
                </Text>
                <Input
                    id="user-id-input"
                    {...register('user_id', { required: requiredMessages.userId })}
                    className={hasAttemptedSubmit && errors.user_id ? 'border-red-500' : ''}
                />
                {errors.user_id && (
                    <Text as="p" size="1" color="red" className="mt-1">
                        {errors.user_id.message}
                    </Text>
                )}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    {t('form.fields.contactNameId', { defaultValue: 'Contact Name ID' })}
                </Text>
                <Input
                    id="contact-name-id-input"
                    {...register('contact_name_id')}
                />
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    {t('form.fields.clientId', { defaultValue: 'Client ID' })}
                </Text>
                <Input
                    id="client-id-input"
                    {...register('client_id')}
                />
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    {t('form.fields.ticketId', { defaultValue: 'Ticket ID' })}
                </Text>
                <Input
                    id="ticket-id-input"
                    {...register('ticket_id')}
                />
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    {t('form.fields.orderNumber', { defaultValue: 'Order Number *' })}
                </Text>
                <Input
                    id="order-number-input"
                    type="number"
                    {...register('order_number', { required: requiredMessages.orderNumber })}
                    className={hasAttemptedSubmit && errors.order_number ? 'border-red-500' : ''}
                />
                {errors.order_number && (
                    <Text as="p" size="1" color="red" className="mt-1">
                        {errors.order_number.message}
                    </Text>
                )}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    {t('form.fields.content', { defaultValue: 'Content *' })}
                </Text>
                <TextArea
                    id="content-textarea"
                    {...register('content', { required: requiredMessages.content })}
                    rows={4}
                    className={hasAttemptedSubmit && errors.content ? 'border-red-500' : ''}
                />
                {errors.content && (
                    <Text as="p" size="1" color="red" className="mt-1">
                        {errors.content.message}
                    </Text>
                )}
            </div>

            <div className="pt-4">
                <Button 
                    id="create-document-button" 
                    type="submit" 
                    className={`w-full ${errors.document_name || errors.type_id || errors.user_id || errors.order_number || errors.content ? 'opacity-50' : ''}`}
                >
                    {t('form.submit', { defaultValue: 'Create Document' })}
                </Button>
            </div>
        </form>
    );
};

export default DocumentForm;
