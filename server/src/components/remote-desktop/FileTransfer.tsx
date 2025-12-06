'use client';

/**
 * File Transfer Component for Remote Desktop
 *
 * Provides a UI for transferring files between the browser and the remote agent:
 * - Upload files from browser to agent
 * - Download files from agent to browser
 * - Progress tracking with pause/resume
 * - Drag and drop support
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';

// Types for file transfer protocol
export interface FileTransferMessage {
  type: 'request' | 'response' | 'chunk' | 'ack' | 'complete' | 'error' | 'cancel' | 'resume' | 'progress' | 'list_files' | 'file_list';
  transfer_id?: string;
  [key: string]: unknown;
}

export interface FileRequest {
  transfer_id: string;
  direction: 'upload' | 'download';
  path: string;
  filename?: string;
  file_size?: number;
  mime_type?: string;
}

export interface FileResponse {
  transfer_id: string;
  accepted: boolean;
  file_size: number;
  filename: string;
  chunk_size: number;
  error?: string;
}

export interface FileChunk {
  transfer_id: string;
  sequence: number;
  data: string; // base64
  is_last: boolean;
}

export interface FileProgress {
  transfer_id: string;
  transferred: number;
  total: number;
  speed_bps: number;
  eta_seconds?: number;
}

export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  modified?: number;
  mime_type?: string;
  hidden: boolean;
  readable: boolean;
  writable: boolean;
}

export interface ActiveTransfer {
  id: string;
  filename: string;
  direction: 'upload' | 'download';
  totalSize: number;
  transferred: number;
  state: 'pending' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'cancelled';
  speed: number;
  eta?: number;
  error?: string;
  startedAt: Date;
  file?: File;
  chunks?: Blob[];
  receivedChunks?: number;
  totalChunks?: number;
}

interface FileTransferProps {
  dataChannel: RTCDataChannel | null;
  onClose?: () => void;
  maxFileSize?: number;
  className?: string;
}

const DEFAULT_MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB
const DEFAULT_CHUNK_SIZE = 16 * 1024; // 16 KB

export function FileTransfer({
  dataChannel,
  onClose,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  className = '',
}: FileTransferProps): React.ReactElement {
  const [transfers, setTransfers] = useState<Map<string, ActiveTransfer>>(new Map());
  const [currentPath, setCurrentPath] = useState<string>('~');
  const [fileList, setFileList] = useState<FileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chunkBuffers = useRef<Map<string, ArrayBuffer[]>>(new Map());

  // Handle incoming messages from the data channel
  useEffect(() => {
    if (!dataChannel) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const message: FileTransferMessage = JSON.parse(event.data);
        handleIncomingMessage(message);
      } catch (e) {
        console.error('Failed to parse file transfer message:', e);
      }
    };

    dataChannel.addEventListener('message', handleMessage);
    return () => {
      dataChannel.removeEventListener('message', handleMessage);
    };
  }, [dataChannel]);

  // Request initial file listing
  useEffect(() => {
    if (dataChannel && dataChannel.readyState === 'open') {
      requestFileList(currentPath);
    }
  }, [dataChannel, currentPath]);

  const sendMessage = useCallback((message: FileTransferMessage) => {
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(message));
    }
  }, [dataChannel]);

  const handleIncomingMessage = useCallback((message: FileTransferMessage) => {
    switch (message.type) {
      case 'file_list':
        handleFileListResponse(message as unknown as { path: string; entries: FileEntry[]; error?: string });
        break;
      case 'response':
        handleTransferResponse(message as unknown as FileResponse);
        break;
      case 'chunk':
        handleChunk(message as unknown as FileChunk);
        break;
      case 'progress':
        handleProgress(message as unknown as FileProgress);
        break;
      case 'complete':
        handleComplete(message as unknown as { transfer_id: string; checksum?: string });
        break;
      case 'error':
        handleError(message as unknown as { transfer_id: string; code: string; message: string });
        break;
    }
  }, []);

  const handleFileListResponse = useCallback((response: { path: string; entries: FileEntry[]; error?: string }) => {
    setLoadingFiles(false);
    if (response.error) {
      setError(response.error);
      return;
    }
    setFileList(response.entries || []);
    setCurrentPath(response.path);
  }, []);

  const handleTransferResponse = useCallback((response: FileResponse) => {
    setTransfers(prev => {
      const updated = new Map(prev);
      const transfer = updated.get(response.transfer_id);
      if (transfer) {
        if (response.accepted) {
          transfer.state = 'in_progress';
          transfer.totalSize = response.file_size;

          if (transfer.direction === 'upload' && transfer.file) {
            // Start sending chunks
            startUpload(response.transfer_id, transfer.file, response.chunk_size);
          } else if (transfer.direction === 'download') {
            // Prepare to receive chunks
            transfer.totalChunks = Math.ceil(response.file_size / response.chunk_size);
            transfer.receivedChunks = 0;
            chunkBuffers.current.set(response.transfer_id, []);
          }
        } else {
          transfer.state = 'failed';
          transfer.error = response.error;
        }
        updated.set(response.transfer_id, transfer);
      }
      return updated;
    });
  }, []);

  const handleChunk = useCallback((chunk: FileChunk) => {
    // Decode base64 chunk
    const binaryString = atob(chunk.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const buffer = bytes.buffer;

    // Store chunk
    const chunks = chunkBuffers.current.get(chunk.transfer_id) || [];
    chunks[chunk.sequence] = buffer;
    chunkBuffers.current.set(chunk.transfer_id, chunks);

    // Update transfer progress
    setTransfers(prev => {
      const updated = new Map(prev);
      const transfer = updated.get(chunk.transfer_id);
      if (transfer) {
        transfer.receivedChunks = (transfer.receivedChunks || 0) + 1;
        transfer.transferred += buffer.byteLength;
        updated.set(chunk.transfer_id, transfer);
      }
      return updated;
    });

    // Send acknowledgment
    sendMessage({
      type: 'ack',
      transfer_id: chunk.transfer_id,
      sequence: chunk.sequence,
    });
  }, [sendMessage]);

  const handleProgress = useCallback((progress: FileProgress) => {
    setTransfers(prev => {
      const updated = new Map(prev);
      const transfer = updated.get(progress.transfer_id);
      if (transfer) {
        transfer.transferred = progress.transferred;
        transfer.speed = progress.speed_bps;
        transfer.eta = progress.eta_seconds;
        updated.set(progress.transfer_id, transfer);
      }
      return updated;
    });
  }, []);

  const handleComplete = useCallback((complete: { transfer_id: string; checksum?: string }) => {
    setTransfers(prev => {
      const updated = new Map(prev);
      const transfer = updated.get(complete.transfer_id);
      if (transfer) {
        transfer.state = 'completed';

        if (transfer.direction === 'download') {
          // Assemble file from chunks and trigger download
          const chunks = chunkBuffers.current.get(complete.transfer_id);
          if (chunks) {
            const blob = new Blob(chunks);
            downloadBlob(blob, transfer.filename);
            chunkBuffers.current.delete(complete.transfer_id);
          }
        }

        updated.set(complete.transfer_id, transfer);
      }
      return updated;
    });
  }, []);

  const handleError = useCallback((error: { transfer_id: string; code: string; message: string }) => {
    setTransfers(prev => {
      const updated = new Map(prev);
      const transfer = updated.get(error.transfer_id);
      if (transfer) {
        transfer.state = 'failed';
        transfer.error = error.message;
        updated.set(error.transfer_id, transfer);
      }
      return updated;
    });
    chunkBuffers.current.delete(error.transfer_id);
  }, []);

  const requestFileList = useCallback((path: string) => {
    setLoadingFiles(true);
    setError(null);
    sendMessage({
      type: 'list_files',
      path,
      include_hidden: false,
    });
  }, [sendMessage]);

  const startDownload = useCallback((entry: FileEntry) => {
    if (entry.is_directory) {
      requestFileList(entry.path);
      return;
    }

    if (entry.size > maxFileSize) {
      setError(`File too large. Maximum size is ${formatSize(maxFileSize)}`);
      return;
    }

    const transferId = uuidv4();
    const transfer: ActiveTransfer = {
      id: transferId,
      filename: entry.name,
      direction: 'download',
      totalSize: entry.size,
      transferred: 0,
      state: 'pending',
      speed: 0,
      startedAt: new Date(),
    };

    setTransfers(prev => new Map(prev).set(transferId, transfer));

    const request: FileRequest = {
      transfer_id: transferId,
      direction: 'download',
      path: entry.path,
    };

    sendMessage({ type: 'request', ...request });
  }, [maxFileSize, sendMessage, requestFileList]);

  const startUpload = useCallback(async (transferId: string, file: File, chunkSize: number) => {
    const totalChunks = Math.ceil(file.size / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      // Read chunk as base64
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data URL prefix
          resolve(result.split(',')[1]);
        };
        reader.readAsDataURL(chunk);
      });

      sendMessage({
        type: 'chunk',
        transfer_id: transferId,
        sequence: i,
        data: base64,
        is_last: i === totalChunks - 1,
      });

      // Update progress
      setTransfers(prev => {
        const updated = new Map(prev);
        const transfer = updated.get(transferId);
        if (transfer) {
          transfer.transferred = end;
          updated.set(transferId, transfer);
        }
        return updated;
      });

      // Small delay to avoid overwhelming the data channel
      await new Promise(r => setTimeout(r, 1));
    }

    // Send completion
    sendMessage({
      type: 'complete',
      transfer_id: transferId,
    });
  }, [sendMessage]);

  const uploadFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(file => {
      if (file.size > maxFileSize) {
        setError(`File "${file.name}" is too large. Maximum size is ${formatSize(maxFileSize)}`);
        return;
      }

      const transferId = uuidv4();
      const transfer: ActiveTransfer = {
        id: transferId,
        filename: file.name,
        direction: 'upload',
        totalSize: file.size,
        transferred: 0,
        state: 'pending',
        speed: 0,
        startedAt: new Date(),
        file,
      };

      setTransfers(prev => new Map(prev).set(transferId, transfer));

      const request: FileRequest = {
        transfer_id: transferId,
        direction: 'upload',
        path: currentPath,
        filename: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
      };

      sendMessage({ type: 'request', ...request });
    });
  }, [currentPath, maxFileSize, sendMessage]);

  const cancelTransfer = useCallback((transferId: string) => {
    sendMessage({
      type: 'cancel',
      transfer_id: transferId,
      reason: 'User cancelled',
    });

    setTransfers(prev => {
      const updated = new Map(prev);
      const transfer = updated.get(transferId);
      if (transfer) {
        transfer.state = 'cancelled';
        updated.set(transferId, transfer);
      }
      return updated;
    });

    chunkBuffers.current.delete(transferId);
  }, [sendMessage]);

  const navigateUp = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      requestFileList('/' + parts.join('/') || '~');
    }
  }, [currentPath, requestFileList]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  }, [uploadFiles]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const activeTransfers = Array.from(transfers.values()).filter(
    t => t.state === 'pending' || t.state === 'in_progress'
  );
  const completedTransfers = Array.from(transfers.values()).filter(
    t => t.state === 'completed' || t.state === 'failed' || t.state === 'cancelled'
  );

  return (
    <div
      className={`flex flex-col bg-white dark:bg-gray-800 rounded-lg shadow-lg ${className}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">File Transfer</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Path navigation */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900">
        <button
          onClick={navigateUp}
          className="p-1 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          title="Go up"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
        <span className="flex-1 text-sm text-gray-600 dark:text-gray-400 truncate">
          {currentPath}
        </span>
        <button
          onClick={() => requestFileList(currentPath)}
          className="p-1 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          title="Refresh"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* File list */}
      <div
        className={`flex-1 overflow-y-auto min-h-[200px] max-h-[300px] ${
          isDragging ? 'bg-blue-50 dark:bg-blue-900/20 border-2 border-dashed border-blue-400' : ''
        }`}
      >
        {loadingFiles ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : fileList.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            {isDragging ? 'Drop files here to upload' : 'No files'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {fileList.map((entry) => (
              <li
                key={entry.path}
                onClick={() => startDownload(entry)}
                className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
              >
                {/* Icon */}
                <span className="text-gray-400">
                  {entry.is_directory ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                    </svg>
                  )}
                </span>
                {/* Name */}
                <span className="flex-1 text-sm text-gray-900 dark:text-white truncate">
                  {entry.name}
                </span>
                {/* Size */}
                {!entry.is_directory && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {formatSize(entry.size)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Upload button */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          multiple
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Upload Files
        </button>
      </div>

      {/* Active transfers */}
      {activeTransfers.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900">
            Active Transfers ({activeTransfers.length})
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[150px] overflow-y-auto">
            {activeTransfers.map((transfer) => (
              <li key={transfer.id} className="px-4 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-900 dark:text-white truncate flex-1">
                    {transfer.direction === 'upload' ? '↑' : '↓'} {transfer.filename}
                  </span>
                  <button
                    onClick={() => cancelTransfer(transfer.id)}
                    className="ml-2 text-red-500 hover:text-red-700"
                    title="Cancel"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${(transfer.transferred / transfer.totalSize) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                  <span>
                    {formatSize(transfer.transferred)} / {formatSize(transfer.totalSize)}
                  </span>
                  <span>
                    {transfer.speed > 0 && `${formatSize(transfer.speed)}/s`}
                    {transfer.eta !== undefined && ` - ${formatTime(transfer.eta)}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Completed transfers */}
      {completedTransfers.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900">
            Completed ({completedTransfers.length})
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[100px] overflow-y-auto">
            {completedTransfers.slice(-5).map((transfer) => (
              <li key={transfer.id} className="px-4 py-2 flex items-center justify-between">
                <span className="text-sm text-gray-900 dark:text-white truncate">
                  {transfer.direction === 'upload' ? '↑' : '↓'} {transfer.filename}
                </span>
                <span className={`text-xs ${
                  transfer.state === 'completed' ? 'text-green-500' :
                  transfer.state === 'failed' ? 'text-red-500' : 'text-gray-500'
                }`}>
                  {transfer.state === 'completed' && '✓ Done'}
                  {transfer.state === 'failed' && `✗ ${transfer.error || 'Failed'}`}
                  {transfer.state === 'cancelled' && '⊘ Cancelled'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Helper functions
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export default FileTransfer;
