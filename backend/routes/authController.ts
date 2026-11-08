import { Router, Request, Response, NextFunction } from "express";
import {
  signupUser,
  loginUser,
  refreshToken,
  logoutUser,
  requestPasswordReset,
  completePasswordReset,
  listUsers,
  disableUser,
  deleteUser,
} from "../auth/service";
import { AuthServiceError } from "../auth/errors";

const router = Router();

function asyncHandler<T extends (...args: any[]) => Promise<any>>(handler: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function requireBodyFields<T extends Record<string, unknown>>(body: T, fields: Array<keyof T>) {
  const missing = fields.filter((field) => {
    const value = body[field];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    throw new AuthServiceError(`Missing required fields: ${missing.join(", ")}`, 400);
  }
}

function extractBearerToken(req: Request): string {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    throw new AuthServiceError("Authorization header with Bearer token required", 401);
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new AuthServiceError("Authorization header with Bearer token required", 401);
  }
  return token;
}

router.post(
  "/auth/signup",
  asyncHandler(async (req: Request, res: Response) => {
    requireBodyFields(req.body ?? {}, ["email", "password"]);
    const result = await signupUser({
      email: req.body.email,
      password: req.body.password,
      user_metadata: req.body.user_metadata,
    });
    res.status(201).json(result);
  })
);

router.post(
  "/auth/login",
  asyncHandler(async (req: Request, res: Response) => {
    requireBodyFields(req.body ?? {}, ["email", "password"]);
    const result = await loginUser({ email: req.body.email, password: req.body.password });
    res.status(200).json(result);
  })
);

router.post(
  "/auth/refresh",
  asyncHandler(async (req: Request, res: Response) => {
    requireBodyFields(req.body ?? {}, ["refresh_token"]);
    const result = await refreshToken(req.body.refresh_token);
    res.status(200).json(result);
  })
);

router.post(
  "/auth/logout",
  asyncHandler(async (req: Request, res: Response) => {
    requireBodyFields(req.body ?? {}, ["refresh_token"]);
    const result = await logoutUser(req.body.refresh_token);
    res.status(200).json(result);
  })
);

router.post(
  "/auth/password-reset/request",
  asyncHandler(async (req: Request, res: Response) => {
    requireBodyFields(req.body ?? {}, ["email"]);
    const result = await requestPasswordReset({ email: req.body.email });
    res.status(200).json(result);
  })
);

router.post(
  "/auth/password-reset/complete",
  asyncHandler(async (req: Request, res: Response) => {
    requireBodyFields(req.body ?? {}, ["user_id", "new_password"]);
    const result = await completePasswordReset({
      user_id: req.body.user_id,
      new_password: req.body.new_password,
    });
    res.status(200).json(result);
  })
);

router.get(
  "/auth/admin/users",
  asyncHandler(async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    const result = await listUsers(token);
    res.status(200).json(result);
  })
);

router.post(
  "/auth/admin/users/:id/disable",
  asyncHandler(async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    requireBodyFields(req.params ?? {}, ["id"]);
    const result = await disableUser(req.params.id, token);
    res.status(200).json(result);
  })
);

router.delete(
  "/auth/admin/users/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    requireBodyFields(req.params ?? {}, ["id"]);
    const result = await deleteUser(req.params.id, token);
    res.status(200).json(result);
  })
);

router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AuthServiceError) {
    const payload: Record<string, unknown> = { error: err.message };
    if (err.details) {
      payload.details = err.details;
    }
    return res.status(err.status).json(payload);
  }

  if (err instanceof Error) {
    return res.status(500).json({ error: err.message });
  }

  return res.status(500).json({ error: "Unknown error" });
});

export default router;
