'use client';
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Button } from '@alga-psa/ui/components/Button';
import { Text } from '@radix-ui/themes';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
const DocumentForm = ({ onSubmit }) => {
    const { register, handleSubmit, formState: { errors } } = useForm();
    const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
    const handleFormSubmit = (data) => {
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
    const validationErrors = [];
    if (hasAttemptedSubmit) {
        if (errors.document_name)
            validationErrors.push('Document name is required');
        if (errors.type_id)
            validationErrors.push('Document type is required');
        if (errors.user_id)
            validationErrors.push('User ID is required');
        if (errors.order_number)
            validationErrors.push('Order number is required');
        if (errors.content)
            validationErrors.push('Content is required');
    }
    return (<form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4" noValidate>
            {hasAttemptedSubmit && validationErrors.length > 0 && (<Alert variant="destructive">
                    <AlertDescription>
                        Please fix the following errors:
                        <ul className="list-disc pl-5 mt-1 text-sm">
                            {validationErrors.map((err, index) => (<li key={index}>{err}</li>))}
                        </ul>
                    </AlertDescription>
                </Alert>)}
            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Document Name *
                </Text>
                <Input {...register('document_name', { required: 'Document name is required' })} className={hasAttemptedSubmit && errors.document_name ? 'border-red-500' : ''}/>
                {errors.document_name && (<Text as="p" size="1" color="red" className="mt-1">
                        {errors.document_name.message}
                    </Text>)}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Document Type *
                </Text>
                <Input {...register('type_id', { required: 'Document type is required' })} className={hasAttemptedSubmit && errors.type_id ? 'border-red-500' : ''}/>
                {errors.type_id && (<Text as="p" size="1" color="red" className="mt-1">
                        {errors.type_id.message}
                    </Text>)}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    User ID *
                </Text>
                <Input {...register('user_id', { required: 'User ID is required' })} className={hasAttemptedSubmit && errors.user_id ? 'border-red-500' : ''}/>
                {errors.user_id && (<Text as="p" size="1" color="red" className="mt-1">
                        {errors.user_id.message}
                    </Text>)}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Contact Name ID
                </Text>
                <Input {...register('contact_name_id')}/>
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Client ID
                </Text>
                <Input {...register('client_id')}/>
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Ticket ID
                </Text>
                <Input {...register('ticket_id')}/>
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Order Number *
                </Text>
                <Input type="number" {...register('order_number', { required: 'Order number is required' })} className={hasAttemptedSubmit && errors.order_number ? 'border-red-500' : ''}/>
                {errors.order_number && (<Text as="p" size="1" color="red" className="mt-1">
                        {errors.order_number.message}
                    </Text>)}
            </div>

            <div>
                <Text as="label" size="2" weight="medium" className="block mb-2">
                    Content *
                </Text>
                <TextArea {...register('content', { required: 'Content is required' })} rows={4} className={hasAttemptedSubmit && errors.content ? 'border-red-500' : ''}/>
                {errors.content && (<Text as="p" size="1" color="red" className="mt-1">
                        {errors.content.message}
                    </Text>)}
            </div>

            <div className="pt-4">
                <Button id="create-document-button" type="submit" className={`w-full ${errors.document_name || errors.type_id || errors.user_id || errors.order_number || errors.content ? 'opacity-50' : ''}`}>
                    Create Document
                </Button>
            </div>
        </form>);
};
export default DocumentForm;
//# sourceMappingURL=DocumentForm.jsx.map