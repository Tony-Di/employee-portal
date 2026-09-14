import multer from 'multer';
import { ValidationError } from '../errors.js';
import { MAX_UPLOAD_BYTES } from '../services/media.js';

const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 30, fieldSize: 16 * 1024 } });

// Parses an optional single-file multipart form. Upload problems are kept on req.uploadError so the
// route can re-render the form with what was typed instead of failing the whole request.
export function optionalUpload(field) {
  const handle = parser.single(field);
  return (req, res, next) => handle(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      req.body ??= {};
      req.uploadError = new ValidationError({
        file: error.code === 'LIMIT_FILE_SIZE' ? ['图片不能超过 2 MB。', 'Images must be 2 MB or smaller.'] : ['上传内容无效。', 'The upload is invalid.'],
      });
      return next();
    }
    next(error);
  });
}
