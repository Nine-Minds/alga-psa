import { createWriteStream, readFileSync } from 'fs';
import archiver from 'archiver';
import { FileStoreModel } from '../models/storage';
import { StorageService } from '../lib/storage/StorageService';
import { v4 as uuidv4 } from 'uuid';

export class ZipGenerationService {
  private storageService: StorageService;

  constructor(storageService: StorageService) {
    this.storageService = storageService;
  }

  async generateZipFromFileRecords(fileRecords: {file_id: string}[]): Promise<string> {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const outputFilePath = `/tmp/invoices-${Date.now()}.zip`;
    const output = createWriteStream(outputFilePath);

    return new Promise<string>(async (resolve, reject) => {
      output.on('close', () => resolve(outputFilePath));
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      try {
        // Process files sequentially
        let successCount = 0;
        for (const record of fileRecords) {
          try {
            const file = await FileStoreModel.findById(record.file_id);
            if (!file) {
              console.warn(`File not found: ${record.file_id}`);
              continue;
            }
            
            const readStream = await this.storageService.getFileReadStream(file.file_id);
            archive.append(readStream, { name: `${file.original_name}` });
            successCount++;
          } catch (err) {
            console.error(`Error processing file ${record.file_id}:`, err);
            // Continue with next file
          }
        }

        if (successCount > 0) {
          await archive.finalize();
        } else {
          reject(new Error('No files were successfully added to the zip'));
        }
      } catch (err) {
        reject(err);
      }
    }).catch((err) => {
      console.error('Error generating zip file:', err);
      throw err; // Re-throw the error to maintain the Promise<string> return type
    });
  }

  async storeZipFile(zipFilePath: string, metadata: Record<string, unknown>): Promise<string> {
    const fileStore = await FileStoreModel.create({
      fileId: uuidv4(),
      file_name: `invoices-${Date.now()}.zip`,
      original_name: 'invoices.zip',
      mime_type: 'application/zip',
      file_size: 0, // Will be updated after upload
      storage_path: zipFilePath,
      uploaded_by_id: 'system',
    });

    await FileStoreModel.createDocumentSystemEntry({
      fileId: fileStore.file_id,
      category: 'invoice-zip',
      metadata,
    });

    return fileStore.file_id;
  }
}
