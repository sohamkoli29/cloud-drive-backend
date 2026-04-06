import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { supabase } from './config/supabase';
// Import routes
import authRoutes from './controllers/auth.controller';
import folderRoutes from './controllers/folders.controller';
import fileRoutes from './controllers/files.controller';
import shareRoutes from './controllers/shares.controller';
import searchRoutes from './controllers/search.controller';
import starRoutes from './controllers/stars.controller';
// Import error handler
import { handleError } from './utils/errors';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:8080'],
  credentials: true,
  exposedHeaders: ['Content-Disposition']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Health check
// Health check — keep Render + Supabase alive
app.get('/api/health', async (req, res) => {
  try {
    await supabase.from('test').select('message').limit(1).single();
    res.status(200).json({ alive: true, db: 'connected' });
  } catch (err) {
    res.status(200).json({ alive: true, db: 'error' });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/stars', starRoutes);
// 404 handler - FIXED for Express 5
app.use((req, res, next) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const error = handleError(err);
  
  if (process.env.NODE_ENV === 'development') {
    console.error('Error:', {
      message: err.message,
      stack: err.stack,
      statusCode: error.statusCode
    });
  }

  res.status(error.statusCode).json({
    error: error.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Environment: ${process.env.NODE_ENV}`);
  console.log(`🌐 CORS Origin: ${process.env.CORS_ORIGIN}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export default app;