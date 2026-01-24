'use server'

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import { StorageService } from '@alga-psa/documents/storage/StorageService';
import { FileStoreModel } from '../../models/storage';
import { FileStore } from '../../types/storage';

export const uploadFile = withAuth(async (
    _user,
    { tenant },
    formData: FormData
): Promise<{ success: boolean; file?: FileStore; error?: string }> => {
    try {
        const file = formData.get('file') as File;
        if (!file) {
            throw new Error('No file provided');
        }

        const uploaded_by_id = formData.get('uploaded_by_id') as string;

        if (!uploaded_by_id) {
            throw new Error('Missing required fields');
        }

        // Validate file before upload
        await StorageService.validateFileUpload(
            tenant,
            file.type,
            file.size
        );

        // Convert File to Buffer
        const buffer = Buffer.from(await file.arrayBuffer());

        // Upload file using StorageService
        // Note: StorageService doesn't currently support transactions
        const fileRecord = await StorageService.uploadFile(tenant, buffer, file.name, {
            mime_type: file.type,
            uploaded_by_id,
        });

        return { success: true, file: fileRecord };
    } catch (error) {
        console.error('Upload file error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to upload file',
        };
    }
});

export const downloadFile = withAuth(async (
    _user,
    { tenant },
    file_id: string
): Promise<{ success: boolean; data?: { buffer: Buffer; metadata: any }; error?: string }> => {
    try {
        const result = await StorageService.downloadFile(file_id);
        return { success: true, data: result };
    } catch (error) {
        console.error('Download file error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to download file',
        };
    }
});

export const deleteFile = withAuth(async (
    _user,
    { tenant },
    file_id: string,
    deleted_by_id: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        // Delete file using StorageService
        // Note: StorageService doesn't currently support transactions
        await StorageService.deleteFile(file_id, deleted_by_id);
        return { success: true };
    } catch (error) {
        console.error('Delete file error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to delete file',
        };
    }
});

export const validateFileUpload = withAuth(async (
    _user,
    { tenant },
    mime_type: string,
    file_size: number
): Promise<{ success: boolean; error?: string }> => {
    console.log('Starting validateFileUpload:', { mime_type, file_size });
    try {
        console.log('Tenant found:', tenant);

        await StorageService.validateFileUpload(tenant, mime_type, file_size);
        console.log('File validation successful');
        return { success: true };
    } catch (error) {
        console.error('Validate file error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to validate file',
        };
    }
});
