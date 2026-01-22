import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validateRequest, validateParams } from '../middleware/validation';
import { authenticate } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { handleError,NotFoundError } from '../utils/errors';
import { getUuidParam } from '../utils/helpers';

const router = Router();
router.use(authenticate);

const starSchema = Joi.object({
  resourceType: Joi.string().valid('file', 'folder').required(),
  resourceId: Joi.string().uuid().required()
});

// Toggle star
router.post('/toggle', validateRequest(starSchema), async (req: Request, res: Response) => {
  try {
    const { resourceType, resourceId } = req.body;
    const userId = req.user!.id;

    // Check if resource exists
    const table = resourceType === 'file' ? 'files' : 'folders';
    const { data: resource } = await supabase
      .from(table)
      .select('id')
      .eq('id', resourceId)
      .eq('is_deleted', false)
      .single();

    if (!resource) {
      throw new NotFoundError(resourceType === 'file' ? 'File' : 'Folder');
    }

    // Check if already starred
    const { data: existingStar } = await supabase
      .from('stars')
      .select('*')
      .eq('user_id', userId)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .single();

    if (existingStar) {
      // Unstar
      await supabase
        .from('stars')
        .delete()
        .eq('id', existingStar.id);
      
      res.json({ message: 'Unstarred', starred: false });
    } else {
      // Star
      await supabase
        .from('stars')
        .insert({
          user_id: userId,
          resource_type: resourceType,
          resource_id: resourceId
        });
      
      res.json({ message: 'Starred', starred: true });
    }
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Get starred items
router.get('/starred', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    // Get starred files
    const { data: starredFiles } = await supabase
      .from('files')
      .select('*, stars!inner(*)')
      .eq('stars.user_id', userId)
      .eq('is_deleted', false);

    // Get starred folders
    const { data: starredFolders } = await supabase
      .from('folders')
      .select('*, stars!inner(*)')
      .eq('stars.user_id', userId)
      .eq('is_deleted', false);

    res.json({
      files: starredFiles || [],
      folders: starredFolders || []
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

export default router;