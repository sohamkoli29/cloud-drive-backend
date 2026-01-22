import { supabaseAdmin } from '../config/supabase';
import { v4 as uuidv4 } from 'uuid';
import { generateShareToken } from '../utils/helpers';

export class StorageService {
  static async generatePresignedUrl(
    userId: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number
  ) {
    const fileExt = fileName.split('.').pop() || 'bin';
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `tenants/${userId}/${uuidv4()}/${sanitizedName}`;
    
    const { data, error } = await supabaseAdmin.storage
      .from(process.env.STORAGE_BUCKET || 'drive-files')
      .createSignedUploadUrl(storageKey, {
        upsert: false
      });
    
    if (error) throw error;
    
    return {
      fileId: uuidv4(),
      storageKey,
      uploadUrl: data.signedUrl,
      path: data.path
    };
  }

  static async generateDownloadUrl(storageKey: string, expiresIn: number = 3600): Promise<string> {
    const { data, error } = await supabaseAdmin.storage
      .from(process.env.STORAGE_BUCKET || 'drive-files')
      .createSignedUrl(storageKey, expiresIn);
    
    if (error) throw error;
    
    return data.signedUrl;
  }

  static async deleteFile(storageKey: string): Promise<void> {
    const { error } = await supabaseAdmin.storage
      .from(process.env.STORAGE_BUCKET || 'drive-files')
      .remove([storageKey]);
    
    if (error) throw error;
  }

// Already exists, ensure it's working
static async copyFile(sourceKey: string, destinationKey: string): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(process.env.STORAGE_BUCKET || 'drive-files')
    .copy(sourceKey, destinationKey);
  
  if (error) {
    console.error('Copy file error:', error);
    throw new Error(`Failed to copy file: ${error.message}`);
  }
}

  static async getFileSize(storageKey: string): Promise<number> {
  try {
    // Try to get the file directly
    const { data, error } = await supabaseAdmin.storage
      .from(process.env.STORAGE_BUCKET || 'drive-files')
      .download(storageKey);
    
    if (error) {
      throw error;
    }
    
    // Alternative: List with proper path
    const pathParts = storageKey.split('/');
    const fileName = pathParts.pop();
    const folderPath = pathParts.join('/');
    
    const { data: listData, error: listError } = await supabaseAdmin.storage
      .from(process.env.STORAGE_BUCKET || 'drive-files')
      .list(folderPath, {
        search: fileName
      });
    
    if (listError || !listData || listData.length === 0) {
      throw new Error('File not found');
    }
    
    return listData[0].metadata?.size || 0;
  } catch (error) {
    console.error('Error getting file size:', error);
    throw new Error('File not found in storage');
  }
}
}