'use client';

export async function downloadDocumentInBrowser(documentId: string, documentName: string) {
  try {
    // Create a download URL using the API endpoint
    const response = await fetch(`/api/documents/${documentId}/download`, {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Download failed');
    }

    // Get the blob from the response
    const blob = await response.blob();
    
    // Create a temporary URL for the blob
    const url = window.URL.createObjectURL(blob);
    
    // Create a temporary anchor element and trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = documentName;
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    return { success: true };
  } catch (error) {
    console.error('Error downloading document:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Download failed' 
    };
  }
}