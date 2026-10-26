import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  /** true only for anonymous demo sessions (POST /auth/guest) — lets the API
   *  accept the token while refusing everything except demo:// work. */
  guest?: boolean;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"]
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
}
