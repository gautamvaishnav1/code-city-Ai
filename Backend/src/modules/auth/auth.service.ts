import bcrypt from "bcryptjs";
import { UserModel, type UserDocument, type AuthProvider } from "./user.model";
import { ApiError } from "../../shared/utils/api-error";
import { signAccessToken } from "../../shared/utils/jwt.util";
import { randomToken, sha256 } from "../../shared/utils/crypto.util";
import { env } from "../../config/env";
import { isProd } from "../../config/env";
import type { LoginInput, RegisterInput } from "./auth.validation";
import { issueOtp, consumeOtp } from "./otp.service";
import type { OAuthProfile } from "./oauth.service";

/* --------------------------- brute-force lockout --------------------------- */
const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

/** devCode is a localhost-only convenience — never expose it in production. */
function devCodePayload(result: { delivered: boolean; devCode?: string }): Record<string, unknown> {
  return !isProd && !result.delivered && result.devCode ? { devCode: result.devCode } : {};
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  provider: AuthProvider;
  avatarUrl?: string | null;
  isVerified: boolean;
}

function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    provider: user.provider,
    avatarUrl: user.avatarUrl ?? null,
    isVerified: user.isVerified
  };
}

function issueTokenFor(user: UserDocument): string {
  return signAccessToken({ sub: user._id.toString(), email: user.email });
}

/* ------------------------ refresh-token session pair ----------------------- */

export interface SessionTokens {
  /** short-lived JWT (default 15m) — sent as `Authorization: Bearer ...` */
  accessToken: string;
  /** opaque one-active-per-user token — used only to mint new pairs */
  refreshToken: string;
}

/**
 * Mints an access token plus a rotating refresh token. The refresh token is
 * random (not a JWT), stored hashed, and single-active: issuing a new one
 * invalidates the previous one, and presenting a stale one is treated as a
 * potential theft signal by the caller.
 */
async function issueSession(user: UserDocument): Promise<SessionTokens> {
  const refreshToken = randomToken();
  await UserModel.updateOne(
    { _id: user._id },
    {
      refreshToken: {
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + env.refreshTokenTtlMs)
      }
    }
  );
  return { accessToken: issueTokenFor(user), refreshToken };
}

/**
 * Exchanges a valid refresh token for a fresh pair (rotation). Only ONE
 * refresh token is ever active per user, so a token that no longer matches
 * the stored hash is expired, already rotated, or stolen — all rejected.
 */
export async function rotateRefreshToken(presented: string): Promise<{ user: PublicUser } & SessionTokens> {
  // refreshToken is deselected by default — select it explicitly
  const user = await UserModel.findOne({ "refreshToken.tokenHash": sha256(presented) }).select("+refreshToken");
  if (!user || !user.refreshToken) throw ApiError.unauthorized("Invalid refresh token");
  if (user.refreshToken.expiresAt.getTime() < Date.now()) {
    user.refreshToken = null;
    await user.save();
    throw ApiError.unauthorized("Refresh token expired — log in again");
  }
  const tokens = await issueSession(user); // rotates: overwrites the stored hash
  return { user: toPublicUser(user), ...tokens };
}

/** Revokes the active refresh token (logout). Idempotent. */
export async function revokeRefreshToken(presented: string): Promise<void> {
  await UserModel.updateOne({ "refreshToken.tokenHash": sha256(presented) }, { refreshToken: null });
}

/* ------------------------- local register + OTP ------------------------- */

/**
 * Step 1 of manual signup: create (or refresh) an UNVERIFIED user and email
 * a 6-digit OTP. No JWT is returned until the code is verified.
 */
export async function requestRegistration(
  input: RegisterInput
): Promise<{ message: string; devCode?: string }> {
  const existing = await UserModel.findOne({ email: input.email });
  if (existing?.isVerified) {
    throw ApiError.conflict("An account with this email already exists. Try logging in.");
  }

  if (existing) {
    // unverified duplicate -> refresh credentials and resend flow
    existing.name = input.name || existing.name;
    existing.passwordHash = await bcrypt.hash(input.password, 10);
    await existing.save();
  } else {
    await UserModel.create({
      email: input.email,
      name: input.name ?? "",
      passwordHash: await bcrypt.hash(input.password, 10),
      provider: "local",
      isVerified: false
    });
  }

  const result = await issueOtp(input.email, "register");
  return {
    message: `Verification code sent to ${input.email}. It expires in 10 minutes.`,
    ...devCodePayload(result)
  };
}

/** Step 2 of manual signup: verify the emailed OTP -> verified user + tokens. */
export async function verifyRegistration(
  email: string,
  code: string
): Promise<{ user: PublicUser } & SessionTokens> {
  const user = await UserModel.findOne({ email });
  if (!user) throw ApiError.notFound("No pending registration for this email");
  if (user.isVerified) return { user: toPublicUser(user), ...(await issueSession(user)) };
  await consumeOtp(email, "register", code);
  user.isVerified = true;
  await user.save();
  return { user: toPublicUser(user), ...(await issueSession(user)) };
}

/** Resend the signup OTP (60s cooldown enforced inside otp.service). */
export async function resendVerificationOtp(email: string): Promise<{ message: string; devCode?: string }> {
  const user = await UserModel.findOne({ email });
  if (!user) throw ApiError.notFound("No account found for this email");
  if (user.isVerified) throw ApiError.badRequest("This account is already verified — just log in.");

  const result = await issueOtp(email, "register");
  return {
    message: `New verification code sent to ${email}.`,
    ...devCodePayload(result)
  };
}

/* -------------------------------- login -------------------------------- */

export async function loginUser(
  input: LoginInput
): Promise<{ user: PublicUser; needsVerification?: boolean } & SessionTokens> {
  // lockout counters are deselected by default — load them explicitly
  const user = await UserModel.findOne({ email: input.email }).select("+failedLoginAttempts +lockUntil");

  if (user?.lockUntil && user.lockUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60_000);
    throw ApiError.tooManyRequests(
      `Account temporarily locked after too many failed logins. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
    );
  }

  const passwordOk = user ? await user.comparePassword(input.password) : false;

  if (!user || !passwordOk) {
    // Only password-backed accounts accumulate failures — otherwise anyone
    // could lock out OAuth users by spamming wrong passwords at their email.
    if (user && user.passwordHash) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= MAX_FAILED_LOGINS) {
        user.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
        user.failedLoginAttempts = 0; // fresh count once the lock lifts
      }
      await user.save();
    }
    throw ApiError.unauthorized("Invalid email or password");
  }

  if (user.failedLoginAttempts > 0 || user.lockUntil) {
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();
  }

  if (user.provider === "local" && !user.isVerified) {
    // auto-resend the code to smooth the demo path
    const result = await issueOtp(user.email, "register").catch(() => ({ delivered: true }) as { delivered: boolean; devCode?: string });
    throw new ApiError(403, "Please verify your email first — we sent you a fresh code.", {
      needsVerification: true,
      email: user.email,
      ...devCodePayload(result)
    });
  }
  return { user: toPublicUser(user), ...(await issueSession(user)) };
}

/* ---------------------------- forgot password --------------------------- */

export async function forgotPassword(email: string): Promise<{ message: string; devCode?: string }> {
  const user = await UserModel.findOne({ email });
  // Always answer the same way so accounts cannot be enumerated.
  const generic = { message: "If that account exists, a reset code has been sent." };
  if (!user || (user.provider !== "local" && !user.passwordHash)) {
    return generic; // OAuth-only users have no password to reset here
  }
  const result = await issueOtp(email, "password_reset").catch(() => ({ delivered: true }) as { delivered: boolean; devCode?: string });
  return {
    ...generic,
    ...devCodePayload(result)
  };
}

export async function resetPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<{ message: string }> {
  const user = await UserModel.findOne({ email });
  if (!user) throw ApiError.badRequest("Invalid code or email");

  await consumeOtp(email, "password_reset", code);
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.isVerified = true; // proven ownership of the mailbox
  // proven identity => clear any brute-force lockout and kill active sessions
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.refreshToken = null;
  await user.save();
  return { message: "Password updated. You can now log in." };
}

/* ------------------------------- OAuth ---------------------------------- */

export async function loginOrCreateFromOAuth(
  provider: "google" | "github",
  profile: OAuthProfile
): Promise<{ user: PublicUser } & SessionTokens> {
  let user =
    (await UserModel.findOne({
      email: profile.email,
      [provider === "google" ? "googleId" : "githubId"]: profile.providerId
    })) ??
    (provider === "google"
      ? await UserModel.findOne({ googleId: profile.providerId })
      : await UserModel.findOne({ githubId: profile.providerId }));

  if (!user) {
    // link by email when possible, otherwise create a fresh verified account
    user = (await UserModel.findOne({ email: profile.email })) ?? null;
  }

  if (!user) {
    user = await UserModel.create({
      email: profile.email,
      name: profile.name,
      provider,
      googleId: provider === "google" ? profile.providerId : null,
      githubId: provider === "github" ? profile.providerId : null,
      avatarUrl: profile.avatarUrl ?? null,
      isVerified: true // trusted provider verified the mailbox
    });
  } else {
    if (user.passwordHash === "" || user.provider === "local") {
      user.provider = provider; // upgrade local -> linked oauth
    }
    if (provider === "google") user.googleId = user.googleId ?? profile.providerId;
    else user.githubId = user.githubId ?? profile.providerId;
    user.avatarUrl = user.avatarUrl ?? profile.avatarUrl ?? null;
    user.name = user.name || profile.name;
    user.isVerified = true;
    await user.save();
  }

  return { user: toPublicUser(user), ...(await issueSession(user)) };
}

export async function getUserById(userId: string): Promise<PublicUser> {
  const user = await UserModel.findById(userId);
  if (!user) throw ApiError.notFound("User not found");
  return toPublicUser(user);
}
