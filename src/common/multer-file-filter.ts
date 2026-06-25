import { Request } from "express";
import { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";

export function fileFilter(
  allowedTypes: string[],
): MulterOptions["fileFilter"] {
  return (
    _req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (allowedTypes.includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(
        new Error(
          `File type "${file.mimetype}" is not allowed. Accepted types: ${allowedTypes.join(", ")}`,
        ),
        false,
      );
    }
  };
}
