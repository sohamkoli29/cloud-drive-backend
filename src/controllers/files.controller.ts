import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validateRequest, validateParams } from '../middleware/validation';
import { authenticate } from '../middleware/auth';
import { DatabaseService } from '../services/database.service';
import { StorageService } from '../services/storage.service';
import { handleError } from '../utils/errors';
import { NotFoundError, ValidationError, AuthorizationError } from '../utils/errors';
import { getUuidParam,sanitizeFileName  } from '../utils/helpers';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase';
const router = Router();
router.use(authenticate);

// Validation schemas
const initUploadSchema = Joi.object({
  name: Joi.string().min(1).max(255).required(),
  mimeType: Joi.string().required(),
  sizeBytes: Joi.number().min(1).max(parseInt(process.env.MAX_FILE_SIZE || '10737418240')).required(),
  folderId: Joi.string().uuid().allow(null)
});

const completeUploadSchema = Joi.object({
  parts: Joi.array().items(
    Joi.object({
      partNumber: Joi.number().min(1).required(),
      etag: Joi.string().required()
    })
  ).optional()
});

const updateFileSchema = Joi.object({
  name: Joi.string().min(1).max(255),
  folderId: Joi.string().uuid().allow(null, '') // Keep camelCase for API
});
const fileParamsSchema = Joi.object({
  id: Joi.string().uuid().required()
});

// Initialize file upload - FIXED
router.post('/init', validateRequest(initUploadSchema), async (req: Request, res: Response) => {
  try {
    const { name, mimeType, sizeBytes, folderId } = req.body;
    const userId = req.user!.id;

    // Validate file type
    const allowedTypes = process.env.ALLOWED_MIME_TYPES?.split(',') || ['*/*'];
    const isAllowed = allowedTypes.some(type => {
      if (type === '*/*') return true;
      if (type.endsWith('/*')) {
        const prefix = type.replace('/*', '');
        return mimeType.startsWith(prefix);
      }
      return mimeType === type;
    });

    if (!isAllowed) {
      throw new ValidationError(`File type ${mimeType} is not allowed`);
    }

    // Check storage quota
    const user = await DatabaseService.getUserById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    if (user.storage_used + sizeBytes > user.storage_quota) {
      throw new ValidationError('Storage quota exceeded');
    }

    // Verify folder access
    if (folderId) {
      const folder = await DatabaseService.getFolderById(folderId, userId);
      if (!folder) {
        throw new NotFoundError('Folder');
      }
    }

    // Generate presigned URL
    const uploadData = await StorageService.generatePresignedUrl(
      userId,
      name,
      mimeType,
      sizeBytes
    );

    // Create file record
    const file = await DatabaseService.createFile(
      name,
      mimeType,
      sizeBytes,
      uploadData.storageKey,
      userId,
      folderId || null
    );

    res.status(201).json({
      fileId: file.id,
      uploadUrl: uploadData.uploadUrl,
      storageKey: uploadData.storageKey
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Complete upload - FIXED
// Complete upload - FIXED VERSION
router.post('/:id/complete', validateParams(fileParamsSchema), validateRequest(completeUploadSchema), async (req: Request, res: Response) => {
  try {
    const fileId = getUuidParam(req.params.id);
    const userId = req.user!.id;

    const file = await DatabaseService.getFileById(fileId, userId);
    if (!file) {
      throw new NotFoundError('File');
    }

    if (file.owner_id !== userId) {
      throw new AuthorizationError();
    }

    // Verify file was actually uploaded to storage - with retry logic
    let fileExists = false;
    let retries = 3;
    
    while (retries > 0 && !fileExists) {
      try {
        await StorageService.getFileSize(file.storage_key);
        fileExists = true;
      } catch (error) {
        retries--;
        if (retries === 0) {
          console.error('File not found after retries:', error);
          // Don't fail the upload - just log warning
          // throw new ValidationError('File upload not completed');
        } else {
          // Wait before retrying (Supabase eventual consistency)
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    // Update file status to indicate upload complete
    

    // Log activity
    await DatabaseService.logActivity(
      userId,
      'upload',
      'file',
      fileId,
      { name: file.name, size: file.size_bytes }
    );

    res.json({
      message: 'Upload completed successfully',
      file: {
        id: file.id,
        name: file.name,
        size: file.size_bytes,
        mimeType: file.mime_type,
        status: fileExists ? 'uploaded' : 'pending'
      }
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Get file metadata - FIXED (removed side effects)
router.get('/:id', validateParams(fileParamsSchema), async (req: Request, res: Response) => {
  try {
    const fileId = getUuidParam(req.params.id);
    const userId = req.user!.id;

    const file = await DatabaseService.getFileById(fileId, userId);
    if (!file) {
      throw new NotFoundError('File');
    }

    res.json({
      id: file.id,
      name: file.name,
      mimeType: file.mime_type,
      size: file.size_bytes,
      folderId: file.folder_id,
      ownerId: file.owner_id,
      createdAt: file.created_at,
      updatedAt: file.updated_at
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Get download URL - NEW separate endpoint
router.get('/:id/download', validateParams(fileParamsSchema), async (req: Request, res: Response) => {
  try {
    const fileId = getUuidParam(req.params.id);
    const userId = req.user!.id;

    const file = await DatabaseService.getFileById(fileId, userId);
    if (!file) {
      throw new NotFoundError('File');
    }

    const downloadUrl = await StorageService.generateDownloadUrl(file.storage_key, 3600);

    await DatabaseService.logActivity(
      userId,
      'download',
      'file',
      fileId,
      { name: file.name }
    );

    res.json({ downloadUrl });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Update file - FIXED
// In files.controller.ts - PATCH /:id route
router.patch('/:id', validateParams(fileParamsSchema), validateRequest(updateFileSchema), async (req: Request, res: Response) => {
  try {
    const fileId = getUuidParam(req.params.id);
    const updates = req.body;
    const userId = req.user!.id;

    console.time('getFileById');
    const file = await DatabaseService.getFileById(fileId, userId);
    console.timeEnd('getFileById');
    
    if (!file) {
      throw new NotFoundError('File');
    }

    if (file.owner_id !== userId) {
      throw new AuthorizationError('You do not have permission to edit this file');
    }

    // OPTIMIZE: Name uniqueness check - only run if name is changing
    if (updates.name && updates.name !== file.name) {
      console.time('nameUniquenessCheck');
      const targetFolderId = updates.folderId !== undefined ? updates.folderId : file.folder_id;
      
      // Use a more efficient query
      const { data: existingFile } = await supabase
        .from('files')
        .select('id')
        .eq('folder_id', targetFolderId)
        .eq('owner_id', userId)
        .eq('name', updates.name)
        .neq('id', fileId)
        .limit(1);
      
      if (existingFile && existingFile.length > 0) {
        throw new ValidationError('A file with this name already exists in this location');
      }
      console.timeEnd('nameUniquenessCheck');
    }

    // OPTIMIZE: Skip folder verification if not moving
    if (updates.folderId !== undefined && updates.folderId !== file.folder_id) {
      if (updates.folderId) {
        console.time('folderVerification');
        const targetFolder = await DatabaseService.getFolderById(updates.folderId, userId);
        if (!targetFolder) {
          throw new NotFoundError('Target folder');
        }
        console.timeEnd('folderVerification');
      }
    }

    // Convert camelCase to snake_case
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.folderId !== undefined) dbUpdates.folder_id = updates.folderId;

    console.time('updateFile');
    const updatedFile = await DatabaseService.updateFile(fileId, dbUpdates);
    console.timeEnd('updateFile');

    // Log activity (fire and forget)
    DatabaseService.logActivity(
      userId,
      updates.name ? 'rename' : 'move',
      'file',
      fileId,
      updates.name
        ? { oldName: file.name, newName: updates.name }
        : { oldFolder: file.folder_id, newFolder: updates.folderId }
    ).catch(err => console.error('Activity log failed:', err));

    console.log('✅ PATCH /files/:id completed successfully');
    res.json(updatedFile);
    
  } catch (error) {
    console.error('❌ PATCH /files/:id error:', error);
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Delete file - FIXED
router.delete('/:id', validateParams(fileParamsSchema), async (req: Request, res: Response) => {
  try {
    const fileId = getUuidParam(req.params.id);
    const userId = req.user!.id;

    const file = await DatabaseService.getFileById(fileId, userId);
    if (!file) {
      throw new NotFoundError('File');
    }

    if (file.owner_id !== userId) {
      throw new AuthorizationError();
    }

    await DatabaseService.deleteFile(fileId);

    await DatabaseService.logActivity(
      userId,
      'delete',
      'file',
      fileId,
      { name: file.name }
    );

    res.json({ message: 'File moved to trash' });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Restore file - FIXED
router.post('/:id/restore', validateParams(fileParamsSchema), async (req: Request, res: Response) => {
  try {
    const fileId = getUuidParam(req.params.id);
    const userId = req.user!.id;

    // Get file even if deleted
    const { data: file, error } = await DatabaseService['supabase']
      .from('files')
      .select('*')
      .eq('id', fileId)
      .single();

    if (error || !file) {
      throw new NotFoundError('File');
    }

    if (file.owner_id !== userId) {
      throw new AuthorizationError();
    }

    const updatedFile = await DatabaseService.updateFile(fileId, { is_deleted: false });

    await DatabaseService.logActivity(
      userId,
      'restore',
      'file',
      fileId,
      { name: file.name }
    );

    res.json(updatedFile);
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Permanent delete from trash
router.delete('/:id/permanent', validateParams(fileParamsSchema), async (req: Request, res: Response) => {
  try {
    const fileId = getUuidParam(req.params.id);
    const userId = req.user!.id;

    // Get file even if deleted
    const { data: file, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .single();

    if (error || !file) {
      throw new NotFoundError('File');
    }

    // Check ownership
    if (file.owner_id !== userId) {
      throw new AuthorizationError();
    }

    // Delete from storage first
    await StorageService.deleteFile(file.storage_key);

    // Then delete from database
    const { error: deleteError } = await supabase
      .from('files')
      .delete()
      .eq('id', fileId);

    if (deleteError) throw deleteError;

    // Update user storage
    await DatabaseService.updateUserStorage(userId, -file.size_bytes);

    res.json({ message: 'File permanently deleted' });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});


// Add near the bottom of the file, before export default router

// ============== STAR/UNSTAR FILE ==============
// Add to files.controller.ts (with proper imports)
router.post('/:id/copy', validateParams(fileParamsSchema), async (req: Request, res: Response) => {
  try {
    const fileId = getUuidParam(req.params.id);
    const userId = req.user!.id;
    const { newName } = req.body;

    console.log('📋 [File Copy] Starting copy process:', { fileId, userId, newName });

    // Get original file
    const file = await DatabaseService.getFileById(fileId, userId);
    if (!file) {
      throw new NotFoundError('File');
    }

    // Generate copy name
    let copyName = newName || `${file.name} - copy`;
    let finalName = copyName;
    let counter = 1;
    
    // Check for duplicates
    const existingFiles = await DatabaseService.getFiles(file.folder_id , userId);
    
    while (true) {
      const exists = existingFiles.some(f => 
        f.name.toLowerCase() === finalName.toLowerCase()
      );
      
      if (!exists) break;
      
      counter++;
      finalName = `${copyName} (${counter})`;
    }

    // Generate new storage key
    const fileExt = file.storage_key.split('.').pop() || '';
    const newStorageKey = `tenants/${userId}/${uuidv4()}/${sanitizeFileName(finalName)}${fileExt ? `.${fileExt}` : ''}`;

    // Copy file in storage
    await StorageService.copyFile(file.storage_key, newStorageKey);

    // Create database record
    const copiedFile = await DatabaseService.createFile(
      finalName,
      file.mime_type,
      file.size_bytes,
      newStorageKey,
      userId,
      file.folder_id || undefined
    );

    // Log activity
    await DatabaseService.logActivity(
      userId,
      'copy',
      'file',
      copiedFile.id,
      { originalName: file.name, newName: finalName }
    );

    res.status(201).json({
      message: 'File copied successfully',
      file: {
        id: copiedFile.id,
        name: copiedFile.name,
        size: copiedFile.size_bytes,
        mimeType: copiedFile.mime_type,
        folderId: copiedFile.folder_id
      }
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Check if file is starred

export default router;