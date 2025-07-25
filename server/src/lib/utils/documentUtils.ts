export function getDocumentDownloadUrl(file_id: string): string {
    if (!file_id) return '#';
    return `/api/documents/download/${file_id}`;
}

/**
 * Enhanced download function that provides better control over file downloads
 * @param url The download URL
 * @param filename The suggested filename
 * @param useFileSystemAPI Whether to try using the File System Access API (for browsers that support it)
 */
export async function downloadDocument(
    url: string, 
    filename: string,
    useFileSystemAPI: boolean = false
): Promise<void> {
    // Check if File System Access API is available and user wants to use it
    if (useFileSystemAPI && 'showSaveFilePicker' in window) {
        try {
            // Fetch the file
            const response = await fetch(url);
            if (!response.ok) throw new Error('Download failed');
            
            const blob = await response.blob();
            
            // Get file extension from filename
            const extension = filename.split('.').pop() || 'bin';
            
            // Show save file picker
            const handle = await (window as any).showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'Document',
                    accept: { [`application/${extension}`]: [`.${extension}`] }
                }],
            });
            
            // Create a writable stream
            const writable = await handle.createWritable();
            
            // Write the blob to the file
            await writable.write(blob);
            await writable.close();
            
            return;
        } catch (err) {
            // If user cancels or API fails, fall back to traditional download
            console.log('File System Access API failed, falling back to traditional download');
        }
    }
    
    // Traditional download approach
    try {
        // Create a temporary anchor element
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        
        // Append to body, click, and remove
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (error) {
        // Fallback to window.open if anchor method fails
        window.open(url, '_blank');
    }
}

/**
 * Downloads a document using fetch and blob for better control
 * This method allows showing progress and handling errors better
 */
export async function downloadDocumentWithProgress(
    url: string,
    filename: string,
    onProgress?: (progress: number) => void
): Promise<void> {
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Download failed: ${response.statusText}`);
        }
        
        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let receivedLength = 0;
        
        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                
                if (done) break;
                
                chunks.push(value);
                receivedLength += value.length;
                
                if (onProgress && total) {
                    onProgress((receivedLength / total) * 100);
                }
            }
        }
        
        // Combine chunks into single array
        const chunksAll = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
            chunksAll.set(chunk, position);
            position += chunk.length;
        }
        
        // Create blob and download
        const blob = new Blob([chunksAll]);
        const blobUrl = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up
        URL.revokeObjectURL(blobUrl);
    } catch (error) {
        console.error('Download failed:', error);
        throw error;
    }
}
