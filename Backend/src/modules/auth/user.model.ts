import mongoose from "mongoose";
import bcrypt from "bcryptjs";

export type AuthProvider = "local" | "google" | "github";

export interface UserDocument extends mongoose.Document {
  email: string;
  passwordHash?: string; // absent for OAuth-only users
  name: string;
  provider: AuthProvider;
  googleId?: string | null;
  githubId?: string | null;
  avatarUrl?: string | null;
  isVerified: boolean; // local users must verify via OTP
  failedLoginAttempts: number; // brute-force lockout counters
  lockUntil: Date | null; // while set in the future, login is refused
  refreshToken?: {
    tokenHash: string; // sha256 of the active refresh token
    expiresAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const userSchema = new mongoose.Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    passwordHash: { type: String, default: "" }, // empty for OAuth accounts
    name: { type: String, trim: true, default: "", maxlength: 80 },
    provider: { type: String, enum: ["local", "google", "github"], default: "local" },
    googleId: { type: String, default: null },
    githubId: { type: String, default: null },
    avatarUrl: { type: String, default: null },
    isVerified: { type: Boolean, default: false },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
    refreshToken: {
      type: {
        tokenHash: { type: String, required: true },
        expiresAt: { type: Date, required: true }
      },
      default: null,
      select: false
    }
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = async function comparePassword(
  candidate: string
): Promise<boolean> {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.set("toJSON", {
  virtuals: false,
  versionKey: false,
  transform: (_doc, ret) => {
    const plain = ret as unknown as Record<string, unknown>;
    plain.id = String(plain._id);
    delete plain._id;
    delete plain.passwordHash;
    return plain;
  }
});

export const UserModel = mongoose.model<UserDocument>("User", userSchema);
