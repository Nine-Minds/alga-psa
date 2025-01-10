'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { IDocument, UpdateDocumentContentInput } from '@/interfaces/document.interface';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Button } from '@/components/ui/Button';
import { Text } from '@radix-ui/themes';

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
    const { register, handleSubmit, formState: { errors } } = useForm<DocumentFormData>();

    const handleFormSubmit = (data: DocumentFormData) => {
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

    return (
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Document Name
                </Text>
                <Input
                    {...register('document_name', { required: 'Document name is required' })}
                />
                {errors.document_name && (
                    <Text as="p" size="1" color="red" className="mt-1">
                        {errors.document_name.message}
                    </Text>
                )}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Document Type
                </Text>
                <Input
                    {...register('type_id', { required: 'Document type is required' })}
                />
                {errors.type_id && (
                    <Text as="p" size="1" color="red" className="mt-1">
                        {errors.type_id.message}
                    </Text>
                )}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    User ID
                </Text>
                <Input
                    {...register('user_id', { required: 'User ID is required' })}
                />
                {errors.user_id && (
                    <Text as="p" size="1" color="red" className="mt-1">
                        {errors.user_id.message}
                    </Text>
                )}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Contact Name ID
                </Text>
                <Input
                    {...register('contact_name_id')}
                />
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Company ID
                </Text>
                <Input
                    {...register('company_id')}
                />
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Ticket ID
                </Text>
                <Input
                    {...register('ticket_id')}
                />
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Order Number
                </Text>
                <Input
                    type="number"
                    {...register('order_number', { required: 'Order number is required' })}
                />
                {errors.order_number && (
                    <Text as="p" size="1" color="red" className="mt-1">
                        {errors.order_number.message}
                    </Text>
                )}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Content
                </Text>
                <TextArea
                    {...register('content', { required: 'Content is required' })}
                    rows={4}
                />
                {errors.content && (
                    <Text as="p" size="1" color="red" className="mt-1">
                        {errors.content.message}
                    </Text>
                )}
            </div>

            <div className="pt-4">
                <Button id="create-document-button" type="submit" className="w-full">
                    Create Document
                </Button>
            </div>
        </form>
    );
};

export default DocumentForm;
