import { supabase, supabaseAdmin } from '../config/supabase';
import { Folder, File, Share, User, Activity } from '../types';
import { NotFoundError, AuthorizationError, ConflictError } from '../utils/errors';

export class DatabaseService {
  static supabase = supabase;
  static supabaseAdmin = supabaseAdmin;

  // User operations - FIXED
  static async getUserById(id: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  }

  static async getUserByEmail(email: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data;
  }

  static async createUser(userId: string, email: string, name?: string): Promise<User> {
    try {
      // Use RPC function for safe creation
      const { data, error } = await supabaseAdmin
        .rpc('create_user_profile', {
          user_id: userId,
          user_email: email,
          user_name: name || email.split('@')[0]
        });

      if (error) throw error;
      
      if (!data || data.length === 0) {
        throw new Error('Profile creation returned no data');
      }

      return data[0];
    } catch (error: any) {
      if (error.code === '23505') { // Unique violation
        // Profile already exists, fetch it
        const user = await this.getUserById(userId);
        if (user) return user;
      }
      throw error;
    }
  }

  static async updateUserStorage(userId: string, sizeBytes: number): Promise<void> {
    const { error } = await supabaseAdmin
      .rpc('update_user_storage', {
        user_id: userId,
        size_bytes: sizeBytes
      });

    if (error) throw error;
  }
static async createFolder(name: string, ownerId: string, parentId?: string): Promise<Folder> {
  try {
    console.log('📁 [DatabaseService] Creating folder:', { name, ownerId, parentId });
    
    // Check for duplicate names (only if we care)
    const siblings = await this.getFolders(parentId || null, ownerId);
    const duplicate = siblings.find(f => f.name.toLowerCase() === name.toLowerCase());
    
    if (duplicate) {
      console.log('⚠️ Duplicate folder name found:', name);
      // For copy operation, we should handle duplicates differently
      // But for now, let's allow it and let the copy logic handle numbering
    }

    const folderData = {
      name,
      owner_id: ownerId,
      parent_id: parentId || null,
      is_deleted: false
    };

    console.log('📝 Inserting folder data:', folderData);

    const { data, error } = await supabase
      .from('folders')
      .insert(folderData)
      .select()
      .single();

    if (error) {
      console.error('❌ Database error creating folder:', error);
      throw error;
    }

    if (!data) {
      console.error('❌ No data returned from folder creation');
      throw new Error('Folder creation failed - no data returned');
    }

    console.log('✅ Folder created successfully:', data);
    return data;
  } catch (error) {
    console.error('❌ Error in createFolder:', error);
    throw error;
  }
}

static async getFolderById(id: string, userId?: string): Promise<Folder | null> {
  let query = supabase  
    .from('folders')
    .select('*')
    .eq('id', id)
    .eq('is_deleted', false);

  const { data, error } = await query.maybeSingle();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  // Check access if userId provided
  if (data && userId && data.owner_id !== userId) {
    // Check if user has share access
    const hasAccess = await this.checkResourceAccess(userId, id, 'folder');
    if (!hasAccess) return null;
  }

  return data;
}


static async isStarred(userId: string, resourceType: 'file' | 'folder', resourceId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('stars')
    .select('id')
    .eq('user_id', userId)
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)
    .maybeSingle();

  if (error) {
    console.error('Error checking star:', error);
    return false;
  }

  return !!data;
}

static async toggleStar(
  userId: string, 
  resourceType: 'file' | 'folder', 
  resourceId: string
): Promise<{ starred: boolean; message: string }> {
  try {
    console.log('Toggle star request:', { userId, resourceType, resourceId });

    // Check if resource exists
    const table = resourceType === 'file' ? 'files' : 'folders';
    const { data: resource } = await supabase
      .from(table)
      .select('id, owner_id')
      .eq('id', resourceId)
      .eq('is_deleted', false)
      .maybeSingle();

    if (!resource) {
      throw new Error(`${resourceType} not found`);
    }

    // Check if user has access
    if (resource.owner_id !== userId) {
      // Check if shared
      const { data: share } = await supabase
        .from('shares')
        .select('id')
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .eq('grantee_user_id', userId)
        .maybeSingle();

      if (!share) {
        throw new Error('Not authorized to star this resource');
      }
    }

    // Check for existing star
    const { data: existingStar, error: starError } = await supabase
      .from('stars')
      .select('id')
      .eq('user_id', userId)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .maybeSingle();

    if (starError) {
      console.error('Error checking star:', starError);
      throw starError;
    }

    let starred: boolean;
    let message: string;

    if (existingStar) {
      // Unstar
      const { error: deleteError } = await supabase
        .from('stars')
        .delete()
        .eq('id', existingStar.id);

      if (deleteError) throw deleteError;
      
      starred = false;
      message = `${resourceType} unstarred`;
      console.log('Unstarred:', { userId, resourceType, resourceId });
    } else {
      // Star
      const { error: insertError } = await supabase
        .from('stars')
        .insert({
          user_id: userId,
          resource_type: resourceType,
          resource_id: resourceId,
          created_at: new Date().toISOString()
        });

      if (insertError) throw insertError;
      
      starred = true;
      message = `${resourceType} starred`;
      console.log('Starred:', { userId, resourceType, resourceId });
    }

    return { starred, message };
  } catch (error) {
    console.error('Toggle star error:', error);
    throw error;
  }
}



static async getFolders(parentId: string | null, userId: string): Promise<Folder[]> {
  try {
    
    // Get owned folders
    let ownedQuery = supabase
      .from('folders')
      .select('*')
      .eq('owner_id', userId)
      .eq('is_deleted', false)
      .order('name');

    if (parentId === null) {
      ownedQuery = ownedQuery.is('parent_id', null);
    } else {
      ownedQuery = ownedQuery.eq('parent_id', parentId);
    }

    const { data: ownedFolders, error: ownedError } = await ownedQuery;

    if (ownedError) {
      console.error('Error fetching owned folders:', ownedError);
      return [];
    }

    // Get shared folders
    let sharedQuery = supabase
      .from('folders')
      .select(`
        *,
        shares!inner(grantee_user_id)
      `)
      .eq('shares.grantee_user_id', userId)
      .eq('is_deleted', false)
      .order('name');

    if (parentId === null) {
      sharedQuery = sharedQuery.is('parent_id', null);
    } else {
      sharedQuery = sharedQuery.eq('parent_id', parentId);
    }

    const { data: sharedFolders, error: sharedError } = await sharedQuery;

    if (sharedError) {
      console.error('Error fetching shared folders:', sharedError);
    }

    // Combine and deduplicate
    const allFolders = [
      ...(ownedFolders || []), 
      ...(sharedFolders || [])
    ];
    
    const uniqueFolders = Array.from(
      new Map(allFolders.map(f => [f.id, f])).values()
    );

    // Get all stars for these folders in one query
    const folderIds = uniqueFolders.map(f => f.id);
    const { data: stars } = await supabase
      .from('stars')
      .select('resource_id')
      .eq('user_id', userId)
      .eq('resource_type', 'folder')
      .in('resource_id', folderIds);

    const starredIds = new Set(stars?.map(s => s.resource_id) || []);

    // Add starred flag
    const transformedFolders = uniqueFolders.map(folder => ({
      ...folder,
      is_starred: starredIds.has(folder.id) // Backend uses is_starred
    }));

    return transformedFolders;
  } catch (error) {
    console.error('Error in getFolders:', error);
    return [];
  }
}

  static async updateFolder(id: string, updates: Partial<Folder>): Promise<Folder> {
    const { data, error } = await supabase
      .from('folders')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async deleteFolder(id: string): Promise<void> {
    const { error } = await supabase
      .from('folders')
      .update({ 
        is_deleted: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;
  }

  // File operations - FIXED
  static async createFile(
    name: string,
    mimeType: string,
    sizeBytes: number,
    storageKey: string,
    ownerId: string,
    folderId?: string
  ): Promise<File> {
    // Validate file size
    if (sizeBytes <= 0) {
      throw new Error('Invalid file size');
    }

    // Check storage quota
    const user = await this.getUserById(ownerId);
    if (!user) {
      throw new Error('User not found');
    }

    if (user.storage_used + sizeBytes > user.storage_quota) {
      throw new Error('Storage quota exceeded');
    }

    // Check for duplicate names
    const existingFiles = await this.getFiles(folderId || null, ownerId);
    const duplicate = existingFiles.find(f => f.name.toLowerCase() === name.toLowerCase());
    
    if (duplicate) {
      throw new ConflictError('A file with this name already exists');
    }

    const { data, error } = await supabase
      .from('files')
      .insert({
        name,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        storage_key: storageKey,
        owner_id: ownerId,
        folder_id: folderId || null
      })
      .select()
      .single();

    if (error) throw error;

    // Update user storage
    await this.updateUserStorage(ownerId, sizeBytes);

    return data;
  }
// In src/services/database.service.ts
static async getFileById(id: string, userId?: string): Promise<File | null> {
  try {
    console.log('🔍 getFileById:', { id, userId });
    
    const { data: file, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .maybeSingle();

    if (error || !file) {
      console.error('❌ File not found or deleted:', error);
      return null;
    }

    // Check if user is owner
    if (userId && file.owner_id !== userId) {
      console.log('⚠️ User is not owner, checking shares...');
      // Check if user has share access
      const { data: share } = await supabase
        .from('shares')
        .select('id')
        .eq('resource_type', 'file')
        .eq('resource_id', id)
        .eq('grantee_user_id', userId)
        .maybeSingle();
      
      if (!share) {
        console.log('❌ No share access found');
        return null;
      }
    }

    console.log('✅ File found:', file.id);
    return file;
  } catch (error) {
    console.error('❌ Error in getFileById:', error);
    return null;
  }
}
// In DatabaseService.ts - getFiles method
static async getFiles(folderId: string | null, userId: string): Promise<File[]> {
  try {
    // Get owned files WITH star join
    const { data: ownedFiles, error: ownedError } = await supabase
      .from('files')
      .select(`
        *,
        stars!left(user_id)
      `)
      .eq('folder_id', folderId)
      .eq('owner_id', userId)
      .eq('is_deleted', false)
      .order('name');

    if (ownedError) {
      console.error('Error fetching owned files:', ownedError);
      return [];
    }

    // Transform to include star status
    const transformedFiles = (ownedFiles || []).map(file => ({
      ...file,
      starred: file.stars?.some((star: any) => star.user_id === userId) || false,
      is_starred: file.stars?.some((star: any) => star.user_id === userId) || false
    }));

    return transformedFiles;
  } catch (error) {
    console.error('Error in getFiles:', error);
    return [];
  }
}
static async getAllUserFolders(userId: string): Promise<Folder[]> {
  try {
    const { data, error } = await supabase
      .from('folders')
      .select(`
        *,
        shares!inner(grantee_user_id),
        stars!left(user_id)
      `)
      .or(`owner_id.eq.${userId},shares.grantee_user_id.eq.${userId}`)
      .eq('is_deleted', false)
      .order('name');

    if (error) {
      console.error('Error fetching all folders:', error);
      return [];
    }

    // Transform to include starred boolean
    const transformedFolders = (data || []).map(folder => ({
      ...folder,
      starred: folder.stars?.some((star: any) => star.user_id === userId) || false
    }));

    console.log(`getAllUserFolders: Found ${transformedFolders.length} folders`);
    return transformedFolders;
  } catch (error) {
    console.error('Error in getAllUserFolders:', error);
    return [];
  }
}


  static async updateFile(id: string, updates: Partial<File>): Promise<File> {
    const { data, error } = await supabase
      .from('files')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async deleteFile(id: string): Promise<void> {
    const { error } = await supabase
      .from('files')
      .update({ 
        is_deleted: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;
  }

  // Helper to check resource access
  private static async checkResourceAccess(
    userId: string,
    resourceId: string,
    resourceType: 'file' | 'folder'
  ): Promise<boolean> {
    const { data, error } = await supabase
      .from('shares')
      .select('id')
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .eq('grantee_user_id', userId)
      .maybeSingle();

    if (error) return false;
    return !!data;
  }

  // Share operations - unchanged
  static async createShare(
    resourceType: 'file' | 'folder',
    resourceId: string,
    granteeUserId: string,
    role: 'viewer' | 'editor',
    createdBy: string
  ): Promise<Share> {
    const { data, error } = await supabase
      .from('shares')
      .insert({
        resource_type: resourceType,
        resource_id: resourceId,
        grantee_user_id: granteeUserId,
        role,
        created_by: createdBy
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async getShares(resourceType: 'file' | 'folder', resourceId: string): Promise<Share[]> {
    const { data, error } = await supabase
      .from('shares')
      .select('*')
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId);

    if (error) throw error;
    return data || [];
  }

  static async deleteShare(id: string): Promise<void> {
    const { error } = await supabase
      .from('shares')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  // Activity logging
  static async logActivity(
    actorId: string,
    action: string,
    resourceType: 'file' | 'folder',
    resourceId: string,
    context?: any
  ): Promise<void> {
    await supabase
      .from('activities')
      .insert({
        actor_id: actorId,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        context
      });
  }
}