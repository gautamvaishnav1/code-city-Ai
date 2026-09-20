import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, ZodError } from "zod";
import { ApiError } from "../utils/api-error";

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * zod-powered validation middleware. Parsed (and coerced) values replace the
 * originals so controllers always work with validated data.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        const result = schemas.params.safeParse(req.params);
        if (!result.success) {
          throw ApiError.badRequest("Invalid URL parameters", formatIssues(result.error!));
        }
        Object.assign(req.params, result.data);
      }
      if (schemas.query) {
        const result = schemas.query.safeParse(req.query);
        if (!result.success) {
          throw ApiError.badRequest("Invalid query parameters", formatIssues(result.error!));
        }
        Object.assign(req.query, result.data);
      }
      if (schemas.body) {
        const result = schemas.body.safeParse(req.body);
        if (!result.success) {
          throw ApiError.badRequest("Validation failed", formatIssues(result.error!));
        }
        req.body = result.data;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function formatIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message
  }));
}
