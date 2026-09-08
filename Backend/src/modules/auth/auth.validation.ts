import { z } from "zod";

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Must be a valid email");

const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long")
  .regex(/[a-zA-Z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

const otpCodeField = z.string().trim().regex(/^\d{6}$/, "OTP must be exactly 6 digits");

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80).optional().default(""),
  email: emailField,
  password: passwordField
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required").max(128)
});

export const verifyOtpSchema = z.object({
  email: emailField,
  code: otpCodeField
});

export const resendOtpSchema = z.object({
  email: emailField,
  purpose: z.enum(["register", "password_reset"]).optional().default("register")
});

export const forgotPasswordSchema = z.object({ email: emailField });

export const resetPasswordSchema = z.object({
  email: emailField,
  code: otpCodeField,
  newPassword: passwordField
});

/** Google Identity Services ID token from the frontend. */
export const googleAuthSchema = z.object({
  credential: z.string().min(20, "Google credential (ID token) is required")
});

/** Authorization `code` from the GitHub OAuth redirect. */
export const githubAuthSchema = z.object({
  code: z.string().trim().min(5).max(200)
});

/** Opaque refresh token issued by login/verify-otp/OAuth. */
export const refreshTokenSchema = z.object({
  refreshToken: z.string().trim().min(20, "Refresh token is required").max(512)
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
