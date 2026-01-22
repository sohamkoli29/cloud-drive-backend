import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validateQuery } from '../middleware/validation';
import { authenticate } from '../middleware/auth';
import { DatabaseService } from '../services/database.service';
import { handleError } from '../utils/errors';
import { getStringParam, getNumberParam, getBooleanParam, getQueryParam, getNumberQueryParam, getBooleanQueryParam } from '../utils/helpers';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const searchQuerySchema = Joi.object({
  q: Joi.string().allow(''),
  type: Joi.string().valid('image', 'pdf', 'doc', 'spreadsheet', 'video', 'audio', 'archive', 'default'),
  starred: Joi.boolean(),
  shared: Joi.boolean(),
  folderId: Joi.string().uuid().allow(null, ''),
  limit: Joi.number().min(1).max(100).default(50),
  offset: Joi.number().min(0).default(0)
});

// Search files and folders
router.get('/', validateQuery(searchQuerySchema), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const query = getQueryParam(req.query.q);
    const type = getQueryParam(req.query.type);
    const starred = getBooleanQueryParam(req.query.starred);
    const shared = getBooleanQueryParam(req.query.shared);
    const folderId = getQueryParam(req.query.folderId);
    const limit = getNumberQueryParam(req.query.limit, 50);
    const offset = getNumberQueryParam(req.query.offset, 0);

    // Build search query
    let filesQuery = DatabaseService['supabase']
      .from('files')
      .select('*', { count: 'exact' })
      .eq('owner_id', userId)
      .eq('is_deleted', false)
      .range(offset, offset + limit - 1);

    let foldersQuery = DatabaseService['supabase']
      .from('folders')
      .select('*', { count: 'exact' })
      .eq('owner_id', userId)
      .eq('is_deleted', false)
      .range(offset, offset + limit - 1);

      
    // Apply search query
    if (query) {
      filesQuery = filesQuery.ilike('name', `%${query}%`);
      foldersQuery = foldersQuery.ilike('name', `%${query}%`);
    }

    // Apply type filter
    if (type) {
      const mimeTypes: Record<string, string[]> = {
        image: ['image/%'],
        pdf: ['application/pdf'],
        doc: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        spreadsheet: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        video: ['video/%'],
        audio: ['audio/%'],
        archive: ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed']
      };
      
      if (mimeTypes[type]) {
        filesQuery = filesQuery.in('mime_type', mimeTypes[type]);
      }
    }

    // Apply folder filter
    if (folderId === '' || folderId === 'null') {
      filesQuery = filesQuery.is('folder_id', null);
      foldersQuery = foldersQuery.is('parent_id', null);
    } else if (folderId) {
      filesQuery = filesQuery.eq('folder_id', folderId);
      foldersQuery = foldersQuery.eq('parent_id', folderId);
    }

    // Execute queries
    const [filesResult, foldersResult] = await Promise.all([
      filesQuery,
      foldersQuery
    ]);

    res.json({
      files: filesResult.data || [],
      folders: foldersResult.data || [],
      pagination: {
        total: (filesResult.count || 0) + (foldersResult.count || 0),
        limit,
        offset,
        totalPages: Math.ceil(((filesResult.count || 0) + (foldersResult.count || 0)) / limit)
      }
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Get trash items
router.get('/trash', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const [filesResult, foldersResult] = await Promise.all([
      DatabaseService['supabase']
        .from('files')
        .select('*')
        .eq('owner_id', userId)
        .eq('is_deleted', true)
        .order('updated_at', { ascending: false }),
      DatabaseService['supabase']
        .from('folders')
        .select('*')
        .eq('owner_id', userId)
        .eq('is_deleted', true)
        .order('updated_at', { ascending: false })
    ]);

    res.json({
      files: filesResult.data || [],
      folders: foldersResult.data || []
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

router.get('/starred', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    // Get starred file IDs
    const { data: fileStars } = await DatabaseService['supabase']
      .from('stars')
      .select('resource_id')
      .eq('user_id', userId)
      .eq('resource_type', 'file');

    const starredFileIds = fileStars?.map(s => s.resource_id) || [];

    // Get files with their star status
    const { data: starredFiles } = await DatabaseService['supabase']
      .from('files')
      .select('*')
      .eq('owner_id', userId)
      .eq('is_deleted', false)
      .in('id', starredFileIds);

   // Add this to your getStarred method after getting starred files
const transformedFiles = (starredFiles || []).map(file => ({
  ...file,
  starred: true, // These are starred files from the starred endpoint
  is_starred: true
}));

    // Get starred folder IDs
    const { data: folderStars } = await DatabaseService['supabase']
      .from('stars')
      .select('resource_id')
      .eq('user_id', userId)
      .eq('resource_type', 'folder');

    const starredFolderIds = folderStars?.map(s => s.resource_id) || [];

    // Get folders
    const { data: starredFolders } = await DatabaseService['supabase']
      .from('folders')
      .select('*')
      .eq('owner_id', userId)
      .eq('is_deleted', false)
      .in('id', starredFolderIds);

    const transformedFolders = (starredFolders || []).map(folder => ({
      ...folder,
      starred: true,
      is_starred: true
    }));

    res.json({
      files: transformedFiles,
      folders: transformedFolders
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});



// Get recent items
router.get('/recent', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const [recentFilesResult, recentFoldersResult] = await Promise.all([
      DatabaseService['supabase']
        .from('files')
        .select('*')
        .eq('owner_id', userId)
        .eq('is_deleted', false)
        .gte('updated_at', oneWeekAgo.toISOString())
        .order('updated_at', { ascending: false })
        .limit(50),
      DatabaseService['supabase']
        .from('folders')
        .select('*')
        .eq('owner_id', userId)
        .eq('is_deleted', false)
        .gte('updated_at', oneWeekAgo.toISOString())
        .order('updated_at', { ascending: false })
        .limit(50)
    ]);

    res.json({
      files: recentFilesResult.data || [],
      folders: recentFoldersResult.data || []
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Get shared items
router.get('/shared', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

const sharedFilesResult = await DatabaseService['supabase']
  .from('files')
  .select('*')
  .eq('is_deleted', false)
  .in('id',
    (await DatabaseService['supabase']
      .from('shares')
      .select('resource_id')
      .eq('grantee_user_id', userId)
      .eq('resource_type', 'file')
    ).data?.map(s => s.resource_id) || []
  );

const sharedFoldersResult = await DatabaseService['supabase']
  .from('folders')
  .select('*')
  .eq('is_deleted', false)
  .in('id',
    (await DatabaseService['supabase']
      .from('shares')
      .select('resource_id')
      .eq('grantee_user_id', userId)
      .eq('resource_type', 'folder')
    ).data?.map(s => s.resource_id) || []
  );

    res.json({
      files: sharedFilesResult.data || [],
      folders: sharedFoldersResult.data || []
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

export default router;