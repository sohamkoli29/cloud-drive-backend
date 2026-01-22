import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validateRequest } from '../middleware/validation';
import { generateTokens } from '../utils/helpers';
import { DatabaseService } from '../services/database.service';
import { supabase } from '../config/supabase';
import { AuthenticationError, ValidationError, ConflictError } from '../utils/errors';
import { handleError } from '../utils/errors';

const router = Router();

// Validation schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().max(100).required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required()
});

// Register - FIXED
router.post('/register', validateRequest(registerSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    // Check if user already exists in our database
    const existingUser = await DatabaseService.getUserByEmail(email);
    if (existingUser) {
      throw new ConflictError('User with this email already exists');
    }

    // Sign up with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name }
      }
    });

    if (authError) {
      // Handle specific Supabase errors
      if (authError.message?.includes('already registered')) {
        throw new ConflictError('Email already registered');
      }
      throw new ValidationError(authError.message);
    }

    if (!authData.user) {
      throw new ValidationError('User creation failed');
    }

    // Create profile with retry logic
    let user;
    let retries = 3;
    while (retries > 0) {
      try {
        user = await DatabaseService.createUser(authData.user.id, email, name);
        break;
      } catch (error: any) {
        retries--;
        if (retries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (!user) {
      throw new Error('Profile creation failed');
    }

    // Generate tokens
    const tokens = generateTokens(user.id, user.email);

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        storage_quota: user.storage_quota,
        storage_used: user.storage_used
      },
      ...tokens
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Login - FIXED
router.post('/login', validateRequest(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Authenticate with Supabase
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      throw new AuthenticationError('Invalid email or password');
    }

    if (!authData.user) {
      throw new AuthenticationError('Authentication failed');
    }

    // Get user profile
    let user = await DatabaseService.getUserById(authData.user.id);
    
    // Create profile if doesn't exist (backward compatibility)
    if (!user) {
      user = await DatabaseService.createUser(
        authData.user.id,
        authData.user.email!,
        authData.user.user_metadata?.name || authData.user.email!.split('@')[0]
      );
    }

    // Generate tokens
    const tokens = generateTokens(user.id, user.email);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        storage_quota: user.storage_quota,
        storage_used: user.storage_used
      },
      ...tokens
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Refresh token - FIXED
router.post('/refresh', validateRequest(refreshSchema), async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    
    // Verify refresh token
    const { verifyRefreshToken } = require('../utils/helpers');
    const { userId, email } = verifyRefreshToken(refreshToken);
    
    // Check if user exists
    const user = await DatabaseService.getUserById(userId);
    if (!user) {
      throw new AuthenticationError('User not found');
    }

    // Generate new tokens
    const tokens = generateTokens(userId, email);

    res.json(tokens);
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Logout
router.post('/logout', async (req: Request, res: Response) => {
  try {
    await supabase.auth.signOut();
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

// Get current user - FIXED
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthenticationError('Missing authorization header');
    }

    const token = authHeader.substring(7); // Remove 'Bearer '
    
    if (!token) {
      throw new AuthenticationError('Missing token');
    }

    const { verifyAccessToken } = require('../utils/helpers');
    const { userId } = verifyAccessToken(token);
    
    const user = await DatabaseService.getUserById(userId);
    if (!user) {
      throw new AuthenticationError('User not found');
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
      storage_quota: user.storage_quota,
      storage_used: user.storage_used
    });
  } catch (error) {
    const appError = handleError(error);
    res.status(appError.statusCode).json({ error: appError.message });
  }
});

export default router;