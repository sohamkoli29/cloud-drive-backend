import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/helpers';
import { AuthenticationError } from '../utils/errors';
import { supabase } from '../config/supabase';

// Rate limiting map (in production, use Redis)
const authAttempts = new Map<string, { count: number; resetTime: number }>();

// Fix in src/middleware/auth.ts:
const checkRateLimit = (identifier: string): boolean => {
  const now = Date.now();
  const attempt = authAttempts.get(identifier);
  
  if (!attempt || now > attempt.resetTime) {
    authAttempts.set(identifier, { count: 1, resetTime: now + 30000 }); // 30 seconds
    return true;
  }
  
  if (attempt.count >= 30) { // Increased from 10 to 30
    return false;
  }
  
  attempt.count++;
  return true;
};

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    // Validate authorization header format
    if (!authHeader) {
      throw new AuthenticationError('Authorization header missing');
    }
    
    if (!authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Invalid authorization header format');
    }

    const token = authHeader.substring(7).trim();
    
    if (!token) {
      throw new AuthenticationError('Token missing');
    }

    // Verify token format (basic check)
    if (token.split('.').length !== 3) {
      throw new AuthenticationError('Invalid token format');
    }

    // Rate limiting
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      throw new AuthenticationError('Too many requests');
    }

    // Verify token
    const decoded = verifyAccessToken(token);
    
    // Verify user exists in database
    const { data: user, error } = await supabase
      .from('profiles')
      .select('id, email, name')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      throw new AuthenticationError('User not found');
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email
    };

    next();
  } catch (error: any) {
    // Clear sensitive data from error messages
    if (error.message?.includes('jwt')) {
      next(new AuthenticationError('Invalid token'));
    } else {
      next(error);
    }
  }
};

export const optionalAuthenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      
      if (token && token.split('.').length === 3) {
        const decoded = verifyAccessToken(token);
        
        const { data: user } = await supabase
          .from('profiles')
          .select('id, email')
          .eq('id', decoded.userId)
          .single();

        if (user) {
          req.user = {
            id: user.id,
            email: user.email
          };
        }
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication on error
    next();
  }
};