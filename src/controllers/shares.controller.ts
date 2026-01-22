import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validateRequest, validateParams } from '../middleware/validation';
import { authenticate } from '../middleware/auth';
import { DatabaseService } from '../services/database.service';
import { handleError } from '../utils/errors';
import { NotFoundError, ValidationError, AuthorizationError } from '../utils/errors';
import { getUuidParam, getStringParam } from '../utils/helpers';
import { supabase } from '../config/supabase';


const router = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const createShareSchema = Joi.object({
  resourceType: Joi.string().valid('file', 'folder').required(),
  resourceId: Joi.string().uuid().required(),
   email: Joi.string().email().required(),
  role: Joi.string().valid('viewer', 'editor').required()
});
const createPublicLinkSchema = Joi.object({
  resourceType: Joi.string().valid('file', 'folder').required(),
  resourceId: Joi.string().uuid().required(),
  expiresIn: Joi.number().min(1).max(365).default(7), // days
  password: Joi.string().min(4).max(100).optional()
});
const shareParamsSchema = Joi.object({
  id: Joi.string().uuid().required()
});

const resourceParamsSchema = Joi.object({
  resourceType: Joi.string().valid('file', 'folder').required(),
  resourceId: Joi.string().uuid().required()
});



// List shares for a resource
// In shares.controller.ts - GET /:resourceType/:resourceId route
router.get('/:resourceType/:resourceId', validateParams(resourceParamsSchema), async (req: Request, res: Response) => {
  try {
    const resourceType = getStringParam(req.params.resourceType) as 'file' | 'folder';
    const resourceId = getUuidParam(req.params.resourceId);
    const userId = req.user!.id;

    // Check if resource exists and user has access
    let resource;
    if (resourceType === 'file') {
      resource = await DatabaseService.getFileById(resourceId, userId);
    } else {
      resource = await DatabaseService.getFolderById(resourceId, userId);
    }

    if (!resource) {
      throw new NotFoundError(resourceType === 'file' ? 'File' : 'Folder');
    }

    // Only owner can see shares
    if (resource.owner_id !== userId) {
      throw new AuthorizationError('Only the owner can view shares');
    }

    // Get shares with user details
    const { data: shares, error } = await supabase
      .from('shares')
      .select(`
        *,
        grantee_user:profiles!grantee_user_id(id, email, name, avatar_url)
      `)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId);

    if (error) throw error;

    res.json(shares || []);
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Delete share
router.delete('/:id', validateParams(shareParamsSchema), async (req: Request, res: Response) => {
  try {
    const shareId = getUuidParam(req.params.id);
    const userId = req.user!.id;

    // Get share
    const { data: share, error } = await DatabaseService['supabase']
      .from('shares')
      .select('*, files!inner(*), folders!inner(*)')
      .eq('id', shareId)
      .single();

    if (error || !share) {
      throw new NotFoundError('Share');
    }

    // Check if user is owner of the resource
    const resource = share.resource_type === 'file' ? share.files : share.folders;
    if (resource.owner_id !== userId) {
      throw new AuthorizationError('Only the owner can remove shares');
    }

    await DatabaseService.deleteShare(shareId);

    // Log activity
    await DatabaseService.logActivity(
      userId,
      'unshare',
      share.resource_type,
      share.resource_id,
      { granteeUserId: share.grantee_user_id, resourceName: resource.name }
    );

    res.json({ message: 'Share removed successfully' });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});
router.get('/users/search', async (req: Request, res: Response) => {
  try {
    console.log('🔍 Search user called:', req.query);
    
    const email = getStringParam(req.query.email);
    
    if (!email) {
      console.log('❌ No email provided');
      return res.status(400).json({ 
        error: 'Email parameter is required',
        code: 'MISSING_EMAIL'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log('❌ Invalid email format:', email);
      return res.status(400).json({ 
        error: 'Invalid email format',
        code: 'INVALID_EMAIL'
      });
    }

    console.log('🔎 Searching Supabase for email:', email);
    
    // Search for user
    const { data: user, error } = await supabase
      .from('profiles')
      .select('id, email, name, avatar_url')
      .eq('email', email)
      .single();

    console.log('📊 Supabase response:', { data: user, error });

    if (error) {
      if (error.code === 'PGRST116') { // Not found error code
        console.log('❌ User not found:', email);
        return res.status(404).json({ 
          error: `User with email "${email}" not found. Please ask them to create an account first.`,
          code: 'USER_NOT_FOUND',
          email
        });
      }
      
      console.error('❌ Database error:', error);
      return res.status(500).json({ 
        error: 'Database error',
        code: 'DATABASE_ERROR'
      });
    }

    if (!user) {
      console.log('❌ User not found in database');
      return res.status(404).json({ 
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    console.log('✅ Found user:', user);
    return res.json(user);
  } catch (error: any) {
    console.error('❌ Search user error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// UPDATED: Create share with email instead of UUID
// In src/controllers/shares.controller.ts - POST / route
// In shares.controller.ts - POST / route
// In src/controllers/shares.controller.ts - POST / route
router.post('/', validateRequest(createShareSchema), async (req: Request, res: Response) => {
  try {
    const { resourceType, resourceId, email, role } = req.body;
    const userId = req.user!.id;

    console.log('📤 Share request received:', { 
      resourceType, 
      resourceId, 
      email, 
      role,
      userId 
    });

    // 1. Find user by email
    console.log('🔍 Searching for user by email:', email);
    const { data: userToShareWith, error: userError } = await supabase
      .from('profiles')
      .select('id, email, name')
      .eq('email', email)
      .single();

    if (userError || !userToShareWith) {
      console.log('❌ User not found:', email);
      return res.status(404).json({ 
        error: `User with email "${email}" not found. Please ask them to create an account first.`,
        code: 'USER_NOT_FOUND'
      });
    }

    // 2. Check if user is trying to share with themselves
    if (userToShareWith.id === userId) {
      console.log('❌ Cannot share with yourself');
      return res.status(400).json({ 
        error: 'You cannot share resources with yourself',
        code: 'SELF_SHARE'
      });
    }

    // 3. Verify resource exists and user is owner
    let resource;
    if (resourceType === 'file') {
      resource = await DatabaseService.getFileById(resourceId, userId);
    } else {
      resource = await DatabaseService.getFolderById(resourceId, userId);
    }

    if (!resource) {
      console.log('❌ Resource not found or not owned by user');
      return res.status(404).json({ 
        error: `${resourceType} not found or you don't have permission to share it`,
        code: 'RESOURCE_NOT_FOUND'
      });
    }

    if (resource.owner_id !== userId) {
      console.log('❌ User is not owner of resource');
      return res.status(403).json({ 
        error: 'Only the owner can share this resource',
        code: 'NOT_OWNER'
      });
    }

    // 4. Check if share already exists
    const { data: existingShare } = await supabase
      .from('shares')
      .select('id')
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .eq('grantee_user_id', userToShareWith.id)
      .single();

    if (existingShare) {
      console.log('❌ Share already exists');
      return res.status(409).json({ 
        error: 'This resource is already shared with this user',
        code: 'SHARE_EXISTS'
      });
    }

    // 5. Create share
    console.log('📝 Creating share record...');
    const { data: share, error: shareError } = await supabase
      .from('shares')
      .insert({
        resource_type: resourceType,
        resource_id: resourceId,
        grantee_user_id: userToShareWith.id,
        role: role || 'viewer',
        created_by: userId
      })
      .select()
      .single();

    if (shareError) {
      console.error('❌ Database error creating share:', shareError);
      throw shareError;
    }

    // 6. Log activity
    await DatabaseService.logActivity(
      userId,
      'share',
      resourceType,
      resourceId,
      { 
        granteeUserId: userToShareWith.id,
        granteeEmail: email,
        role,
        resourceName: resource.name
      }
    );

    console.log('✅ Share created successfully:', share);

    // Return share details with user info
    return res.status(201).json({
      ...share,
      grantee_user: {
        id: userToShareWith.id,
        email: userToShareWith.email,
        name: userToShareWith.name
      }
    });

  } catch (error: any) {
    console.error('❌ Share creation error:', error);
    const appError = handleError(error);
    return res.status(appError.statusCode).json({ 
      error: appError.message,
      code: appError.statusCode === 400 ? 'VALIDATION_ERROR' : 
            appError.statusCode === 401 ? 'AUTH_ERROR' : 'INTERNAL_ERROR'
    });
  }
});

router.post('/public-link', validateRequest(createPublicLinkSchema), async (req: Request, res: Response) => {
  try {
    const { resourceType, resourceId, expiresIn, password } = req.body;
    const userId = req.user!.id;

    // Check if resource exists and user is owner
    let resource;
    if (resourceType === 'file') {
      resource = await DatabaseService.getFileById(resourceId, userId);
    } else {
      resource = await DatabaseService.getFolderById(resourceId, userId);
    }

    if (!resource) {
      throw new NotFoundError(resourceType === 'file' ? 'File' : 'Folder');
    }

    // Generate unique token
    const token = require('crypto').randomBytes(32).toString('hex');
    
    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresIn);

    // Create public link record
    const { data: link, error } = await supabase
      .from('link_shares')
      .insert({
        token,
        resource_type: resourceType,
        resource_id: resourceId,
        created_by: userId,
        expires_at: expiresAt.toISOString(),
        password_hash: password ? await require('bcryptjs').hash(password, 10) : null,
        role: 'viewer'
      })
      .select()
      .single();

    if (error) throw error;

    // Generate full URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
    const shareUrl = `${baseUrl}/shared/${token}`;

    res.status(201).json({
      url: shareUrl,
      token,
      expiresAt: link.expires_at,
      hasPassword: !!password
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// NEW: Get public link details
router.get('/public-link/:token', async (req: Request, res: Response) => {
  try {
    const token = getStringParam(req.params.token);

    const { data: link, error } = await supabase
      .from('link_shares')
      .select('*, files(*), folders(*)')
      .eq('token', token)
      .eq('is_active', true)
      .single();

    if (error || !link) {
      throw new NotFoundError('Share link');
    }

    // Check if expired
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new ValidationError('This link has expired');
    }

    res.json(link);
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});
export default router;  