import type { NextFunction, Request, Response } from "express";

export type Sensitivity = "public" | "internal" | "confidential";

export interface AuthContext {
  member_id: string;
  label: string;
  group?: string;
  corpora?: string[];
  scopes?: string[];
  jti: string;
  is_legacy: boolean;
  role?: "viewer" | "searcher" | "admin";
  clearance: Sensitivity;
  products?: string[];
  tokenAlg?: "EdDSA" | "HS256";
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      mcpdocsAuth?: AuthContext;
    }
  }
}

export function loadOrCreateToken(): string {
  return process.env.CCB_MEMBER_CREDENTIAL ?? "";
}

export function authMiddleware(_token: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}
