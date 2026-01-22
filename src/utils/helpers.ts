import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWTPayload } from '../types';

// Generate a unique ID
export const generateId = (): string => uuidv4();

// Password hashing
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

// Password comparison
export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return await bcrypt.compare(password, hash);
};

// JWT Token generation - FIXED VERSION
export const generateTokens = (userId: string, email: string) => {
  const accessTokenSecret = process.env.JWT_ACCESS_SECRET || 'your-access-secret-key';
  const refreshTokenSecret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';
  const accessTokenExpiry = process.env.ACCESS_TOKEN_EXPIRY || '15m';
  const refreshTokenExpiry = process.env.REFRESH_TOKEN_EXPIRY || '7d';

  const accessToken = jwt.sign(
    { userId, email },
    accessTokenSecret,
    { expiresIn: accessTokenExpiry } as jwt.SignOptions // Add type assertion
  );

  const refreshToken = jwt.sign(
    { userId, email },
    refreshTokenSecret,
    { expiresIn: refreshTokenExpiry } as jwt.SignOptions // Add type assertion
  );

  return { accessToken, refreshToken };
};

// Verify access token
export const verifyAccessToken = (token: string): JWTPayload => {
  const secret = process.env.JWT_ACCESS_SECRET || 'your-access-secret-key';
  return jwt.verify(token, secret) as JWTPayload;
};

// Verify refresh token
export const verifyRefreshToken = (token: string): JWTPayload => {
  const secret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';
  return jwt.verify(token, secret) as JWTPayload;
};

// File name sanitization
export const sanitizeFileName = (fileName: string): string => {
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
};

// Get file type from MIME type
export const getFileType = (mimeType: string): string => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'doc';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'spreadsheet';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return 'archive';
  return 'default';
};

// Format bytes to human readable string
export const formatBytes = (bytes: number, decimals: number = 2): string => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// Generate share token
export const generateShareToken = (): string => {
  return uuidv4().replace(/-/g, '');
};

// Query parameter helpers
export const getStringParam = (param: any): string | undefined => {
  if (param === undefined || param === null) {
    return undefined;
  }
  
  if (Array.isArray(param)) {
    return param[0] as string;
  }
  
  return String(param);
};

export const getRequiredStringParam = (param: any): string => {
  const value = getStringParam(param);
  if (!value) {
    throw new Error('Required parameter is missing');
  }
  return value;
};

export const getNumberParam = (param: any, defaultValue: number): number => {
  const value = getStringParam(param);
  if (value === undefined) {
    return defaultValue;
  }
  
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
};

export const getBooleanParam = (param: any, defaultValue: boolean = false): boolean => {
  const value = getStringParam(param);
  if (value === undefined) {
    return defaultValue;
  }
  
  return value === 'true' || value === '1' || value === 'yes';
};

export const getUuidParam = (param: any): string => {
  const value = getRequiredStringParam(param);
  
  if (!value.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    throw new Error('Invalid UUID format');
  }
  
  return value;
};

// Safe parameter extraction for Express
export const getQueryParam = (param: any): string | undefined => getStringParam(param);
export const getRequiredQueryParam = (param: any): string => getRequiredStringParam(param);
export const getNumberQueryParam = (param: any, defaultValue: number): number => getNumberParam(param, defaultValue);
export const getBooleanQueryParam = (param: any, defaultValue: boolean = false): boolean => getBooleanParam(param, defaultValue);

// Add this missing function
export const getOptionalStringParam = (param: any): string | undefined => {
  return getStringParam(param);
};

// Path parameter extraction
export const getPathParam = (param: any): string => getRequiredStringParam(param);
export const getOptionalPathParam = (param: any): string | undefined => getStringParam(param);

// Body parameter validation helpers
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePassword = (password: string): { valid: boolean; message?: string } => {
  if (password.length < 6) {
    return { valid: false, message: 'Password must be at least 6 characters long' };
  }
  
  // Add more password validation rules as needed
  return { valid: true };
};

// Storage quota helpers
export const calculateStoragePercentage = (used: number, total: number): number => {
  if (total === 0) return 0;
  return Math.round((used / total) * 100);
};

export const formatStorage = (bytes: number): string => {
  return formatBytes(bytes);
};

// Date helpers
export const formatDate = (date: Date): string => {
  return date.toISOString();
};

export const getRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

// File operation helpers
export const isValidFileType = (mimeType: string): boolean => {
  const allowedTypes = process.env.ALLOWED_MIME_TYPES?.split(',') || [];
  
  return allowedTypes.some(type => {
    if (type.endsWith('/*')) {
      const prefix = type.replace('/*', '');
      return mimeType.startsWith(prefix);
    }
    return mimeType === type;
  });
};

export const getFileExtension = (fileName: string): string => {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
};

export const generateStorageKey = (userId: string, fileName: string): string => {
  const sanitizedName = sanitizeFileName(fileName);
  const timestamp = Date.now();
  const randomId = uuidv4().slice(0, 8);
  return `tenants/${userId}/${timestamp}_${randomId}_${sanitizedName}`;
};

// Pagination helper
export const getPaginationParams = (pageParam: any, limitParam: any, defaultLimit: number = 50) => {
  const page = getNumberParam(pageParam, 1);
  const limit = getNumberParam(limitParam, defaultLimit);
  const offset = (page - 1) * limit;
  
  return { page, limit, offset };
};

// Response formatting
export const formatPaginatedResponse = <T>(
  data: T[],
  total: number,
  page: number,
  limit: number
) => {
  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    }
  };
};

// Error message formatting
export const formatErrorMessage = (error: any): string => {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  return 'An unexpected error occurred';
};

// Check if user can access resource
export const canAccessResource = async (
  userId: string,
  resourceId: string,
  resourceType: 'file' | 'folder'
): Promise<boolean> => {
  // This would be implemented with your DatabaseService
  // For now, return true as a placeholder
  return true;
};

// Generate random color for avatars
export const generateAvatarColor = (userId: string): string => {
  const colors = [
    'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-red-500',
    'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500'
  ];
  
  // Simple hash function to get consistent color for same userId
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

// Truncate text
export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
};

// Debounce function for search
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// Sleep/delay function
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};