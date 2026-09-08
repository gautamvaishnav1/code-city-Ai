import crypto from "node:crypto";
import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/utils/async-handler";
import * as authService from "./auth.service";
import {
  verifyGoogleIdToken,
  exchangeCodeForProfile,
  githubAuthorizeUrl,
  googleAuthorizeUrl
} from "./oauth.service";
import { env } from "../../config/env";

/* ------------------------- local register + OTP ------------------------- */

export const register = asyncHandler(async (req, res) => {
  const result = await authService.requestRegistration(req.body as never);
  res.status(201).json({ success: true, ...result });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const { email, code } = req.body as { email: string; code: string };
  const { user, accessToken, refreshToken } = await authService.verifyRegistration(email, code);
  res.status(200).json({ success: true, data: { user, token: accessToken, refreshToken } });
});

export const resendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body as { email: string };
  const result = await authService.resendVerificationOtp(email);
  res.status(200).json({ success: true, ...result });
});

/* -------------------------------- login -------------------------------- */

export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.loginUser(req.body as never);
  // `token` kept for backward compatibility — it IS the access token
  res.status(200).json({ success: true, data: { user, token: accessToken, refreshToken } });
});

/* ------------------------- refresh + logout ------------------------------ */

/** POST /api/v1/auth/refresh — rotates the refresh token, returns a new pair. */
export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body as { refreshToken: string };
  const data = await authService.rotateRefreshToken(refreshToken);
  res.status(200).json({
    success: true,
    data: { user: data.user, token: data.accessToken, refreshToken: data.refreshToken }
  });
});

/** POST /api/v1/auth/logout — revokes the presented refresh token. */
export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (refreshToken) await authService.revokeRefreshToken(refreshToken);
  res.status(200).json({ success: true, message: "Logged out." });
});

/* ---------------------------- forgot password --------------------------- */

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body as { email: string };
  const result = await authService.forgotPassword(email);
  res.status(200).json({ success: true, ...result });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { email, code, newPassword } = req.body as {
    email: string;
    code: string;
    newPassword: string;
  };
  const result = await authService.resetPassword(email, code, newPassword);
  res.status(200).json({ success: true, data: result });
});

/* -------------------------------- OAuth --------------------------------- */

function setOAuthStateCookie(res: Response, state: string): void {
  res.setHeader("Set-Cookie", `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
}

function readOAuthStateCookie(req: Request): string | null {
  const raw = (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("oauth_state="));
  return raw ? raw.split("=").slice(1).join("=") : null;
}

/** GET /api/v1/auth/google — browser redirect to Google consent screen. */
export const startGoogleOAuth = asyncHandler(async (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  setOAuthStateCookie(res, state);
  res.redirect(googleAuthorizeUrl(state));
});

/** GET /api/v1/auth/github — browser redirect to GitHub consent screen. */
export const startGithubOAuth = asyncHandler(async (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  setOAuthStateCookie(res, state);
  res.redirect(githubAuthorizeUrl(state));
});

async function finishOAuth(
  provider: "google" | "github",
  code: string | undefined,
  state: string | undefined,
  cookieState: string | null,
  res: Response
): Promise<void> {
  const fail = (msg: string) =>
    res.redirect(`${env.frontendUrl}/auth?error=${encodeURIComponent(msg)}`);

  if (!code || !state || !cookieState || state !== cookieState) {
    return fail("Invalid OAuth state");
  }
  try {
    const profile = await exchangeCodeForProfile(provider, code);
    const { user, accessToken } = await authService.loginOrCreateFromOAuth(provider, profile);
    // NOTE: refresh token intentionally NOT put in the URL — redirect flows
    // can adopt it later via an httpOnly cookie or the SPA POST endpoints.
    const params = new URLSearchParams({ token: accessToken, email: user.email, name: user.name });
    res.redirect(`${env.frontendUrl}/auth/success?${params.toString()}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth failed";
    return fail(msg);
  }
}

export const googleCallback = asyncHandler(async (req, res) => {
  const q = req.query as { code?: string; state?: string };
  await finishOAuth("google", q.code, q.state, readOAuthStateCookie(req), res);
});

export const githubCallback = asyncHandler(async (req, res) => {
  const q = req.query as { code?: string; state?: string };
  await finishOAuth("github", q.code, q.state, readOAuthStateCookie(req), res);
});

/** POST /api/v1/auth/google — ID-token flow for the SPA "Sign in with Google" button. */
export const googleIdTokenLogin = asyncHandler(async (req, res) => {
  const { credential } = req.body as { credential: string };
  const profile = await verifyGoogleIdToken(credential);
  const { user, accessToken, refreshToken } = await authService.loginOrCreateFromOAuth("google", profile);
  res.status(200).json({ success: true, data: { user, token: accessToken, refreshToken } });
});

/** POST /api/v1/auth/github — code flow for SPAs that captured the redirect themselves. */
export const githubCodeLogin = asyncHandler(async (req, res) => {
  const { code } = req.body as { code: string };
  const profile = await exchangeCodeForProfile("github", code);
  const { user, accessToken, refreshToken } = await authService.loginOrCreateFromOAuth("github", profile);
  res.status(200).json({ success: true, data: { user, token: accessToken, refreshToken } });
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.user!.id);
  res.status(200).json({ success: true, data: { user } });
});
