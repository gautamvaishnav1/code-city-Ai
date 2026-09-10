import { Router } from "express";
import {
  register,
  login,
  refresh,
  logout,
  me,
  oauthCallback,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
  startGoogleOAuth,
  googleCallback,
  googleIdTokenLogin,
  startGithubOAuth,
  githubCallback,
  githubCodeLogin
} from "./auth.controller";
import { validate } from "../../shared/middleware/validate.middleware";
import { requireAuth } from "../../shared/middleware/auth.middleware";
import { authLimiter, otpLimiter, refreshTokenLimiter } from "../../shared/middleware/rate-limiter.middleware";
import {
  loginSchema,
  registerSchema,
  verifyOtpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
  googleAuthSchema,
  githubAuthSchema
} from "./auth.validation";

const router = Router();

/* ---------------- public auth endpoints (strict rate limits) ---------------- */

router.post("/register", authLimiter, validate({ body: registerSchema }), register);
router.post("/login", authLimiter, validate({ body: loginSchema }), login);

// token lifecycle — rotation endpoint gets its own tight limit
router.post("/refresh", refreshTokenLimiter, validate({ body: refreshTokenSchema }), refresh);
router.post("/logout", validate({ body: refreshTokenSchema.partial() }), logout);

// OTP flows — even tighter limit than login
router.post("/verify-otp", otpLimiter, validate({ body: verifyOtpSchema }), verifyOtp);
router.post("/resend-otp", otpLimiter, validate({ body: resendOtpSchema }), resendOtp);
router.post("/forgot-password", otpLimiter, validate({ body: forgotPasswordSchema }), forgotPassword);
router.post("/reset-password", otpLimiter, validate({ body: resetPasswordSchema }), resetPassword);

// OAuth — redirect dance (server-side) and token/code flows (SPA)
router.get("/google", startGoogleOAuth);
router.get("/google/callback", googleCallback);
router.post("/google", authLimiter, validate({ body: googleAuthSchema }), googleIdTokenLogin);
router.get("/github", startGithubOAuth);
router.get("/github/callback", githubCallback);
router.post("/github", authLimiter, validate({ body: githubAuthSchema }), githubCodeLogin);

// OAuth callback API — for POST redirect from browser after OAuth complete
router.post("/oauth/callback", oauthCallback);

/* --------------------------------- profile ---------------------------------- */

router.get("/me", requireAuth, me);

export default router;
