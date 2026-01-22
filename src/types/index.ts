import { Request } from 'express';

export interface User {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  storage_quota: number;
  storage_used: number;
  created_at: Date;
  updated_at: Date;
}

export interface Folder {
  id: string;
  name: string;
  owner_id: string;
  parent_id: string | null;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
  starred?: boolean;
}

export interface File {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  owner_id: string;
  folder_id: string | null;
  version_id?: string;
  checksum?: string;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
  starred?: boolean;
}

export interface Share {
  id: string;
  resource_type: 'file' | 'folder';
  resource_id: string;
  grantee_user_id: string;
  role: 'viewer' | 'editor';
  created_by: string;
  created_at: Date;
}

export interface LinkShare {
  id: string;
  resource_type: 'file' | 'folder';
  resource_id: string;
  token: string;
  role: 'viewer';
  password_hash?: string;
  expires_at?: Date;
  created_by: string;
  created_at: Date;
}

export interface Star {
  user_id: string;
  resource_type: 'file' | 'folder';
  resource_id: string;
  created_at: Date;
}

export interface Activity {
  id: string;
  actor_id: string;
  action: string;
  resource_type: 'file' | 'folder';
  resource_id: string;
  context: any;
  created_at: Date;
}

export interface JWTPayload {
  userId: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Request extensions
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
      file?: Express.Multer.File;
    }
  }
}

export interface AuthRequest extends Request {
  user: {
    id: string;
    email: string;
  };
}