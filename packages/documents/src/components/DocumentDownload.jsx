"use client";
import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Download } from 'lucide-react';
const DocumentDownload = ({ document, className }) => {
    if (!document.file_id)
        return null;
    const downloadUrl = `/api/files/${document.file_id}/download`;
    return (<a href={downloadUrl} download={document.document_name} className="no-underline">
            <Button id="download-button" variant="outline" size="sm" className={`text-gray-600 hover:text-gray-900 ${className || ''}`}>
                <Download className="w-4 h-4 mr-2"/>
                Download
            </Button>
        </a>);
};
export default DocumentDownload;
//# sourceMappingURL=DocumentDownload.jsx.map