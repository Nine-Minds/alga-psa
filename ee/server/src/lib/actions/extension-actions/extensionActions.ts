'use server';

import { readFile } from 'fs/promises';
import { join } from 'path';

export async function loadExtensionDescriptor(extensionId: string, componentPath: string) {
  try {
    // Map database UUIDs to actual extension folder names
    const extensionMapping: Record<string, string> = {
      '63a7a0dc-7836-4a5f-aa08-ecdb31b064b5': 'softwareone'
    };
    
    const extensionFolder = extensionMapping[extensionId] || extensionId;
    const filePath = join(process.cwd(), 'extensions', `${extensionFolder}-ext`, 'dist', componentPath);
    
    console.log(`[Extension Action] Loading descriptor from: ${filePath}`);
    
    const fileContent = await readFile(filePath, 'utf-8');
    const descriptor = JSON.parse(fileContent);
    
    return { success: true, descriptor };
  } catch (error) {
    console.error(`[Extension Action] Error loading descriptor:`, error);
    return { success: false, error: `Failed to load descriptor: ${componentPath}` };
  }
}

export async function loadExtensionHandlers(extensionId: string, handlersPath: string) {
  try {
    // Map database UUIDs to actual extension folder names
    const extensionMapping: Record<string, string> = {
      '63a7a0dc-7836-4a5f-aa08-ecdb31b064b5': 'softwareone'
    };
    
    const extensionFolder = extensionMapping[extensionId] || extensionId;
    const filePath = join(process.cwd(), 'extensions', `${extensionFolder}-ext`, 'dist', handlersPath);
    
    console.log(`[Extension Action] Loading handlers from: ${filePath}`);
    
    const fileContent = await readFile(filePath, 'utf-8');
    
    // For browser import, we need to create a data URL or blob URL
    // This allows dynamic import of the module content
    return { 
      success: true, 
      moduleContent: fileContent,
      modulePath: handlersPath 
    };
  } catch (error) {
    console.error(`[Extension Action] Error loading handlers:`, error);
    return { success: false, error: `Failed to load handlers: ${handlersPath}` };
  }
}