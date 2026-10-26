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
import { env, isProd } from "../../config/env";

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

/** POST /api/v1/auth/guest — anonymous session for the bundled demo, so
 *  "explore the demo" never dead-ends on a sign-in wall. The token carries
 *  `guest: true`, which the API maps to demo:// repositories only. */
export const guest = asyncHandler(async (_req, res) => {
  const { user, accessToken, refreshToken } = await authService.createGuestSession();
  res.status(200).json({ success: true, data: { user, token: accessToken, refreshToken } });
});

/* ------------------------- refresh + logout ------------------------------ */

/** httpOnly cookie carrying the refresh token for OAuth redirect users —
 *  the redirect URL itself never contains it. Path-scoped to the auth routes. */
const REFRESH_COOKIE = "cc_rt";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

function readCookieValue(req: Request, name: string): string | null {
  const raw = (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return raw ? decodeURIComponent(raw.slice(name.length + 1)) : null;
}

function setRefreshCookie(res: Response, token: string): void {
  const parts = [
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(env.refreshTokenTtlMs / 1000)}`
  ];
  if (isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearRefreshCookie(res: Response): void {
  const parts = [
    `${REFRESH_COOKIE}=`,
    `Path=${REFRESH_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

/** POST /api/v1/auth/refresh — rotates the refresh token, returns a new pair.
 *  Accepts the token in the body (password/OTP sessions) or the httpOnly
 *  cookie (OAuth redirect sessions); on success the cookie is re-set with the
 *  rotated token so the OAuth flow keeps working across rotations. */
export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  const presented = refreshToken || readCookieValue(req, REFRESH_COOKIE);
  if (!presented) {
    return res.status(400).json({ success: false, message: "Refresh token is required" });
  }
  try {
    const data = await authService.rotateRefreshToken(presented);
    setRefreshCookie(res, data.refreshToken);
    res.status(200).json({
      success: true,
      data: { user: data.user, token: data.accessToken, refreshToken: data.refreshToken }
    });
  } catch (err) {
    clearRefreshCookie(res); // stale or rejected — don't keep replaying it
    throw err;
  }
});

/** POST /api/v1/auth/logout — revokes the presented refresh token (and the
 *  cookie copy if different). Idempotent. */
export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  const cookieRt = readCookieValue(req, REFRESH_COOKIE);
  const presented = refreshToken || cookieRt;
  if (presented) await authService.revokeRefreshToken(presented);
  if (cookieRt && cookieRt !== presented) await authService.revokeRefreshToken(cookieRt);
  clearRefreshCookie(res);
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
    const { user, accessToken, refreshToken } = await authService.loginOrCreateFromOAuth(provider, profile);
    // refresh token travels as an httpOnly cookie (Path=/api/v1/auth) —
    // never in the redirect URL.
    setRefreshCookie(res, refreshToken);
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

export const oauthCallback = asyncHandler(async (req, res) => {
  const { token, email, name } = req.body as { token?: string; email?: string; name?: string };
  if (!token) return res.status(400).json({ success: false, message: "Missing token" });

  try {
    const resApi = await fetch(`${env.frontendUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = (await resApi.json()) as { success: boolean; user?: { id: string; name: string; email: string; provider?: string } };
    if (!data.success || !data.user) throw new Error("Invalid user session");

    res.status(200).json({ success: true, user: data.user, redirect: "/#app" });
  } catch (err) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : "OAuth callback failed" });
  }
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.user!.id);
  res.status(200).json({ success: true, data: { user } });
});
