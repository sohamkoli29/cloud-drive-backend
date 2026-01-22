import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/errors';
import multer from 'multer';

export const validateRequest = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const { error } = schema.validate(req.body);
      if (error) {
        throw new ValidationError(error.details[0].message);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const validateQuery = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const { error } = schema.validate(req.query);
      if (error) {
        throw new ValidationError(error.details[0].message);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const validateParams = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const { error } = schema.validate(req.params);
      if (error) {
        throw new ValidationError(error.details[0].message);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

// File upload validation
export const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10737418240'),
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = process.env.ALLOWED_MIME_TYPES?.split(',') || [];
    
    if (allowedTypes.some(type => {
      if (type.endsWith('/*')) {
        return file.mimetype.startsWith(type.replace('/*', ''));
      }
      return file.mimetype === type;
    })) {
      cb(null, true);
    } else {
      cb(new ValidationError(`File type ${file.mimetype} not allowed`));
    }
  }
});