/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    await knex('shared_document_types').insert([
        {
            type_name: 'image/jpeg',
            icon: '📸',
            description: 'JPEG Image'
        },
        {
            type_name: 'image/png',
            icon: '🖼️',
            description: 'PNG Image'
        },
        {
            type_name: 'image/gif',
            icon: '🎭',
            description: 'GIF Image'
        },
        {
            type_name: 'image/svg+xml',
            icon: '🎨',
            description: 'SVG Image'
        },
        {
            type_name: 'image/webp',
            icon: '📸',
            description: 'WebP Image'
        },
        {
            type_name: 'application/pdf',
            icon: '📄',
            description: 'PDF Document'
        },
        {
            type_name: 'application/msword',
            icon: '📝',
            description: 'Word Document'
        },
        {
            type_name: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            icon: '📝',
            description: 'Word Document (DOCX)'
        },
        {
            type_name: 'application/vnd.ms-excel',
            icon: '📊',
            description: 'Excel Spreadsheet'
        },
        {
            type_name: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            icon: '📊',
            description: 'Excel Spreadsheet (XLSX)'
        },
        {
            type_name: 'application/vnd.ms-powerpoint',
            icon: '📽️',
            description: 'PowerPoint Presentation'
        },
        {
            type_name: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            icon: '📽️',
            description: 'PowerPoint Presentation (PPTX)'
        },
        {
            type_name: 'text/plain',
            icon: '📝',
            description: 'Plain Text'
        },
        {
            type_name: 'text/html',
            icon: '🌐',
            description: 'HTML Document'
        },
        {
            type_name: 'text/css',
            icon: '🎨',
            description: 'CSS Stylesheet'
        },
        {
            type_name: 'text/javascript',
            icon: '⚙️',
            description: 'JavaScript Code'
        },
        {
            type_name: 'text/markdown',
            icon: '📑',
            description: 'Markdown Document'
        },
        {
            type_name: 'application/zip',
            icon: '📦',
            description: 'ZIP Archive'
        },
        {
            type_name: 'application/x-rar-compressed',
            icon: '📦',
            description: 'RAR Archive'
        },
        {
            type_name: 'application/x-7z-compressed',
            icon: '📦',
            description: '7-Zip Archive'
        },
        {
            type_name: 'application/x-tar',
            icon: '📦',
            description: 'TAR Archive'
        },
        {
            type_name: 'application/gzip',
            icon: '📦',
            description: 'GZIP Archive'
        },
        {
            type_name: 'audio/mpeg',
            icon: '🎵',
            description: 'MP3 Audio'
        },
        {
            type_name: 'audio/wav',
            icon: '🎵',
            description: 'WAV Audio'
        },
        {
            type_name: 'audio/ogg',
            icon: '🎵',
            description: 'OGG Audio'
        },
        {
            type_name: 'video/mp4',
            icon: '🎥',
            description: 'MP4 Video'
        },
        {
            type_name: 'video/webm',
            icon: '🎥',
            description: 'WebM Video'
        },
        {
            type_name: 'video/ogg',
            icon: '🎥',
            description: 'OGG Video'
        },
        {
            type_name: 'application/json',
            icon: '📊',
            description: 'JSON Data'
        },
        {
            type_name: 'application/xml',
            icon: '📊',
            description: 'XML Data'
        },
        {
            type_name: 'text/csv',
            icon: '📊',
            description: 'CSV Data'
        },
        {
            type_name: 'application/octet-stream',
            icon: '❓',
            description: 'Unknown File Type'
        }
    ]);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    await knex('shared_document_types').del();
};
