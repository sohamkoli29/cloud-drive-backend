import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import { validateRequest, validateParams, validateQuery } from '../middleware/validation';
import { authenticate } from '../middleware/auth';
import { DatabaseService } from '../services/database.service';
import { handleError } from '../utils/errors';
import { NotFoundError, ValidationError, AuthorizationError } from '../utils/errors';
import { getStringParam, getUuidParam,sanitizeFileName  } from '../utils/helpers';
import { StorageService } from '../services/storage.service'; 
import { supabase } from '../config/supabase';

const router = Router();

// ============== VALIDATION SCHEMAS ==============
const createFolderSchema = Joi.object({
  name: Joi.string().min(1).max(255).required(),
  parentId: Joi.string().uuid().allow(null)
});

const updateFolderSchema = Joi.object({
  name: Joi.string().min(1).max(255),
  parentId: Joi.string().uuid().allow(null)
});

const folderParamsSchema = Joi.object({
  id: Joi.string().uuid().required()
});

const listFoldersQuerySchema = Joi.object({
  parentId: Joi.string().uuid().allow(null, '')
});

// ============== DEBUGGING MIDDLEWARE ==============
router.use((req: Request, res: Response, next: any) => {
  console.log('📁 Folder route:', {
    path: req.path,
    method: req.method,
    params: Object.keys(req.params).length > 0 ? req.params : 'none',
    query: Object.keys(req.query).length > 0 ? req.query : 'none'
  });
  next();
});

// ============== FIXED /with-stars ENDPOINT ==============
// This MUST come BEFORE other routes to avoid validation conflicts
router.get('/with-stars', authenticate, async (req: Request, res: Response) => {
  try {
    console.log('=== /folders/with-stars called ===');
    
    // Get user from request
    const userId = (req as any).user?.id;
    
    if (!userId) {
      console.error('No user ID in request');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    console.log('Fetching starred folders for user:', userId);
    
    // Get all folders user owns
    const { data: folders, error: foldersError } = await supabase
      .from('folders')
      .select('*')
      .eq('is_deleted', false)
      .eq('owner_id', userId)
      .order('name');

    if (foldersError) {
      console.error('Database error fetching folders:', foldersError);
      return res.status(500).json({ 
        error: 'Database error',
        details: foldersError.message 
      });
    }

    console.log(`Found ${folders?.length || 0} folders for user ${userId}`);
    
    // If no folders, return empty array
    if (!folders || folders.length === 0) {
      console.log('No folders found');
      return res.json([]);
    }

    // Get all stars for this user
    const { data: stars, error: starsError } = await supabase
      .from('stars')
      .select('*')
      .eq('user_id', userId)
      .eq('resource_type', 'folder');

    if (starsError) {
      console.error('Database error fetching stars:', starsError);
      // Continue with empty stars array
    }

    console.log(`Found ${stars?.length || 0} stars for user ${userId}`);
    
    // Create a Set of starred folder IDs for quick lookup
    const starredFolderIds = new Set(
      (stars || []).map(star => star.resource_id)
    );

    // Transform folders with star status
    const result = folders.map(folder => ({
      ...folder,
      is_starred: starredFolderIds.has(folder.id)
    }));

    console.log('✅ Returning result:', result.length, 'folders');
    res.json(result);
  } catch (error: any) {
    console.error('❌ Error in /folders/with-stars:', {
      error: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============== OTHER ROUTES ==============

// Create folder
router.post('/', authenticate, validateRequest(createFolderSchema), async (req: Request, res: Response) => {
  try {
    const { name, parentId } = req.body;
    const userId = (req as any).user.id;

    console.log('Creating folder:', { name, parentId, userId });

    // Check if parent folder exists and belongs to user
    if (parentId) {
      const parentFolder = await DatabaseService.getFolderById(parentId, userId);
      if (!parentFolder) {
        throw new NotFoundError('Parent folder');
      }
    }

    // Check for duplicate folder name at same level
    const folders = await DatabaseService.getFolders(parentId || null, userId);
    const duplicate = folders.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      throw new ValidationError('A folder with this name already exists in this location');
    }

    const folder = await DatabaseService.createFolder(name, userId, parentId);
    
    // Log activity
    await DatabaseService.logActivity(
      userId,
      'create_folder',
      'folder',
      folder.id,
      { name }
    );

    res.status(201).json(folder);
  } catch (error) {
    console.error('Error creating folder:', error);
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// List folders
router.get('/', authenticate, validateQuery(listFoldersQuerySchema), async (req: Request, res: Response) => {
  try {
    const parentId = getStringParam(req.query.parentId);
    const userId = (req as any).user.id;

    // Handle empty string, 'null', undefined cases
    const parentFolderId = (!parentId || parentId === 'null' || parentId === 'undefined') 
      ? null 
      : parentId;
    
    console.log('Fetching folders for:', { userId, parentFolderId });
    
    const folders = await DatabaseService.getFolders(parentFolderId, userId);
    
    // Always return array, never null
    res.json(Array.isArray(folders) ? folders : []);
  } catch (error) {
    console.error('Error in list folders:', error);
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Get all folders (simplified)
router.get('/all', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    console.log('GET /folders/all called for user:', userId);
    
    // Simple query - get user's folders
    const { data, error } = await supabase
      .from('folders')
      .select('*')
      .eq('is_deleted', false)
      .eq('owner_id', userId)
      .order('name');

    if (error) {
      console.error('Error fetching all folders:', error);
      return res.json([]);
    }

    console.log(`GET /folders/all returning ${data?.length || 0} folders`);
    res.json(data || []);
  } catch (error) {
    console.error('Error in get all folders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get folder by ID
router.get('/:id', authenticate, validateParams(folderParamsSchema), async (req: Request, res: Response) => {
  try {
    const id = getUuidParam(req.params.id);
    const userId = (req as any).user.id;

    const folder = await DatabaseService.getFolderById(id, userId);
    if (!folder) {
      throw new NotFoundError('Folder');
    }

    // Get folder contents
    const [subfolders, files] = await Promise.all([
      DatabaseService.getFolders(id, userId),
      DatabaseService.getFiles(id, userId)
    ]);

    // Get folder path
    const path = [];
    let currentFolder: any = folder;
    while (currentFolder) {
      path.unshift(currentFolder);
      if (currentFolder.parent_id) {
        currentFolder = await DatabaseService.getFolderById(currentFolder.parent_id, userId) || null;
      } else {
        currentFolder = null;
      }
    }

    res.json({
      folder,
      children: {
        folders: subfolders,
        files: files
      },
      path
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Update folder
router.patch('/:id', authenticate, validateParams(folderParamsSchema), validateRequest(updateFolderSchema), async (req: Request, res: Response) => {
  try {
    const id = getUuidParam(req.params.id);
    const updates = req.body;
    const userId = (req as any).user.id;

    // Check if folder exists and belongs to user
    const folder = await DatabaseService.getFolderById(id, userId);
    if (!folder) {
      throw new NotFoundError('Folder');
    }

    // If renaming, check for duplicate name
    if (updates.name && updates.name !== folder.name) {
      const siblings = await DatabaseService.getFolders(folder.parent_id, userId);
      const duplicate = siblings.find(f => 
        f.id !== id && f.name.toLowerCase() === updates.name.toLowerCase()
      );
      if (duplicate) {
        throw new ValidationError('A folder with this name already exists in this location');
      }
    }

    // If moving, check if target folder exists and isn't a descendant
    if (updates.parentId !== undefined && updates.parentId !== folder.parent_id) {
      if (updates.parentId) {
        const targetFolder = await DatabaseService.getFolderById(updates.parentId, userId);
        if (!targetFolder) {
          throw new NotFoundError('Target folder');
        }

        // Check for circular reference (moving folder into itself or descendant)
        let currentParentId: string | null = updates.parentId;
        while (currentParentId) {
          if (currentParentId === id) {
            throw new ValidationError('Cannot move folder into itself or its descendants');
          }
          const currentFolder = await DatabaseService.getFolderById(currentParentId, userId);
          currentParentId = currentFolder?.parent_id || null;
        }
      }
    }

    const updatedFolder = await DatabaseService.updateFolder(id, updates);
    
    // Log activity
    await DatabaseService.logActivity(
      userId,
      updates.name ? 'rename' : 'move',
      'folder',
      id,
      updates.name ? { oldName: folder.name, newName: updates.name } : { oldParent: folder.parent_id, newParent: updates.parentId }
    );

    res.json(updatedFolder);
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Delete folder (soft delete)
router.delete('/:id', authenticate, validateParams(folderParamsSchema), async (req: Request, res: Response) => {
  try {
    const id = getUuidParam(req.params.id);
    const userId = (req as any).user.id;

    // Check if folder exists and belongs to user
    const folder = await DatabaseService.getFolderById(id, userId);
    if (!folder) {
      throw new NotFoundError('Folder');
    }

    await DatabaseService.deleteFolder(id);
    
    // Log activity
    await DatabaseService.logActivity(
      userId,
      'delete',
      'folder',
      id,
      { name: folder.name }
    );

    res.json({ message: 'Folder moved to trash' });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Get folder path
router.get('/:id/path', authenticate, async (req: Request, res: Response) => {
  try {
    const folderId = getUuidParam(req.params.id);
    const userId = (req as any).user.id;

    const path = [];
    let currentFolder = await DatabaseService.getFolderById(folderId, userId);
    
    if (!currentFolder) {
      throw new NotFoundError('Folder');
    }

    // Add current folder
    path.unshift(currentFolder);

    // Build path to root
    while (currentFolder.parent_id) {
      currentFolder = await DatabaseService.getFolderById(currentFolder.parent_id, userId);
      if (currentFolder) {
        path.unshift(currentFolder);
      } else {
        break;
      }
    }

    res.json({ path });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Permanent delete from trash
router.delete('/:id/permanent', authenticate, validateParams(folderParamsSchema), async (req: Request, res: Response) => {
  try {
    const id = getUuidParam(req.params.id);
    const userId = (req as any).user.id;

    // Get folder even if deleted
    const { data: folder, error } = await supabase
      .from('folders')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !folder) {
      throw new NotFoundError('Folder');
    }

    // Check ownership
    if (folder.owner_id !== userId) {
      throw new AuthorizationError();
    }

    // Permanent delete from database
    const { error: deleteError } = await supabase
      .from('folders')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    res.json({ message: 'Folder permanently deleted' });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Star/unstar a folder
router.post('/:id/copy', validateParams(folderParamsSchema), async (req: Request, res: Response) => {
  try {
    const folderId = getUuidParam(req.params.id);
    const userId = req.user!.id;
    const { newName } = req.body;

    console.log('📋 [Folder Copy] Starting copy process:', { 
      folderId, 
      userId, 
      newName 
    });

    // 1. Get original folder
 const folder = await DatabaseService.getFolderById(folderId, userId);
if (!folder) {
  console.log('❌ [Folder Copy] Original folder not found:', folderId);
  return res.status(404).json({ 
    error: 'Folder not found or no permission',
    folderId 
  });
}

    console.log('📂 [Folder Copy] Original folder found:', { 
      id: folder.id, 
      name: folder.name, 
      parentId: folder.parent_id 
    });

    // 2. Generate unique copy name
    let copyName = newName || `${folder.name} - copy`;
    let finalName = copyName;
    let counter = 1;
    
    console.log('🔤 [Folder Copy] Checking for duplicate names...');
    
    // Get all folders in the same parent directory
    const existingFolders = await DatabaseService.getFolders(folder.parent_id , userId);
    
    // Check for existing name
    const nameExists = existingFolders.some(f => 
      f.name.toLowerCase() === finalName.toLowerCase()
    );
    
    // Add numbering if name exists
    if (nameExists) {
      console.log(`⚠️ [Folder Copy] Name "${finalName}" exists, adding number...`);
      while (true) {
        finalName = `${copyName} (${counter})`;
        const exists = existingFolders.some(f => 
          f.name.toLowerCase() === finalName.toLowerCase()
        );
        
        if (!exists) break;
        counter++;
      }
    }

    console.log('✅ [Folder Copy] Final name:', finalName);

    // 3. Create the new folder (without contents first)
    console.log('🔄 [Folder Copy] Creating new folder...');
    const newFolder = await DatabaseService.createFolder(
      finalName,
      userId,
      folder.parent_id || undefined
    );
if (!newFolder || !newFolder.id) {
  console.error('❌ [Folder Copy] Failed to create folder - no ID returned');
  return res.status(500).json({ 
    error: 'Failed to create folder copy',
    details: 'Database returned no folder ID'
  });
}

    console.log('✅ [Folder Copy] New folder created:', { 
      id: newFolder.id, 
      name: newFolder.name 
    });

    // 4. Copy files from original folder to new folder
    console.log('📁 [Folder Copy] Copying files...');
    const files = await DatabaseService.getFiles(folderId, userId);
    console.log(`📁 [Folder Copy] Found ${files.length} files to copy`);
    
    for (const file of files) {
      try {
        console.log(`📄 [Folder Copy] Copying file: ${file.name}`);
        
        // Generate new storage key
        const fileExt = file.storage_key.split('.').pop() || '';
        const newStorageKey = `tenants/${userId}/${uuidv4()}/${sanitizeFileName(file.name)}${fileExt ? `.${fileExt}` : ''}`;
        
        // Copy file in storage
        await StorageService.copyFile(file.storage_key, newStorageKey);
        
        // Create file record
        await DatabaseService.createFile(
          file.name,
          file.mime_type,
          file.size_bytes,
          newStorageKey,
          userId,
          newFolder.id
        );
        
        console.log(`✅ [Folder Copy] File copied: ${file.name}`);
      } catch (fileError: any) {
        console.error(`❌ [Folder Copy] Error copying file ${file.name}:`, fileError.message);
        // Continue with other files
      }
    }

    // 5. Copy subfolders recursively (simplified - just create empty folders for now)
    console.log('📂 [Folder Copy] Copying subfolders...');
    const subfolders = await DatabaseService.getFolders(folderId, userId);
    console.log(`📂 [Folder Copy] Found ${subfolders.length} subfolders`);
    
    for (const subfolder of subfolders) {
      try {
        console.log(`📁 [Folder Copy] Creating subfolder: ${subfolder.name}`);
        
        // Create subfolder in new parent
        await DatabaseService.createFolder(
          subfolder.name,
          userId,
          newFolder.id
        );
        
        console.log(`✅ [Folder Copy] Subfolder created: ${subfolder.name}`);
      } catch (subfolderError: any) {
        console.error(`❌ [Folder Copy] Error creating subfolder ${subfolder.name}:`, subfolderError.message);
        // Continue with other subfolders
      }
    }

    // 6. Log activity
    await DatabaseService.logActivity(
      userId,
      'copy',
      'folder',
      newFolder.id,
      { originalName: folder.name, newName: finalName }
    );

    console.log('🎉 [Folder Copy] Folder copy completed successfully!');

    res.status(201).json({
      message: 'Folder copied successfully',
      folderId: newFolder.id,
      name: finalName
    });

  } catch (error: any) {
    console.error('❌ [Folder Copy] Error:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    
    const appError = handleError(error);
    res.status(appError.statusCode).json({ 
      error: appError.message,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;