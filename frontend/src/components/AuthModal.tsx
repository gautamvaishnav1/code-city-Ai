import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AtSign, Eye, EyeOff, KeyRound, Loader2, User as UserIcon, X } from "lucide-react";
import { beginSignIn, beginSignUp, oauthStartUrl, resendOtp, verifyOtp } from "../lib/auth";

type Mode = "signin" | "signup";

/* ═══ AUTH — printed identity card ══════════════════════════════════
   Same press system as the landing: paper, ink rules, one signal red.
   Flows: sign-in · sign-up(+OTP) · OAuth redirect · resend cooldown   */

export function AuthModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  if (!open) return null;
  return <AuthInner onClose={onClose} onSuccess={onSuccess} />;
}

function AuthInner({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [mode, setMode] = useState<Mode>("signup");
  const [step, setStep] = useState<"form" | "otp">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [oauthBusy, setOauthBusy] = useState<"google" | "github" | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function oauthClick(provider: "google" | "github") {
    if (oauthBusy) return;
    setOauthBusy(provider);
    setError(null);
    // Backend performs the full redirect dance itself. location.assign() is a
    // plain navigation call (href assignment reads as a mutation to the
    // React-compiler lint).
    window.location.assign(oauthStartUrl(provider));
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("That email doesn't look right.");
    if (password.length < 6) return setError("Password needs at least 6 characters.");
    if (mode === "signup" && name.trim().length < 2) return setError("Tell us your name — it goes on the card.");
    setBusy(true);
    try {
      const result =
        mode === "signin"
          ? await beginSignIn(email.trim(), password)
          : await beginSignUp(name.trim(), email.trim(), password);
      if (result.status === "signed-in") {
        onSuccess();
      } else {
        setStep("otp");
        setDevCode(result.devCode ?? null);
        setCooldown(30);
        setTimeout(() => otpRefs.current[0]?.focus(), 50);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setDigit(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    if (!clean) {
      setDigits((d) => d.map((c, j) => (j === i ? "" : c)));
      return;
    }
    // paste support: fill from position i
    if (clean.length > 1) {
      setDigits((d) => {
        const nd = [...d];
        clean.split("").forEach((ch, k) => { if (i + k < 6) nd[i + k] = ch; });
        return nd;
      });
      otpRefs.current[Math.min(i + clean.length, 5)]?.focus();
      return;
    }
    setDigits((d) => d.map((c, j) => (j === i ? clean : c)));
    if (i < 5) otpRefs.current[i + 1]?.focus();
  }

  function onOtpKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) otpRefs.current[i - 1]?.focus();
    if (e.key === "ArrowLeft" && i > 0) otpRefs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < 5) otpRefs.current[i + 1]?.focus();
  }

  async function submitOtp(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const code = digits.join("");
    if (code.length !== 6) return setError("Enter all six digits.");
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(email.trim(), code);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown > 0) return;
    setError(null);
    try {
      const r = await resendOtp(email.trim());
      setDevCode(r.devCode ?? null);
      setDigits(Array(6).fill(""));
      setCooldown(30);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /* ── OTP step ── */
  if (step === "otp") {
    return (
      <Frame onClose={onClose} innerRef={frame} titleId="cc-otp-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="caption-caps font-bold text-signal">STEP 2 OF 2 — POSTMARK</p>
            <h2 id="cc-otp-title" className="display-caps mt-2 text-3xl">Check your mail</h2>
            <p className="mt-2 text-[13px] leading-5 text-black-ink/70">
              A 6-digit code was sent to <b className="tabular-nums">{email}</b>. It expires in 10 minutes.
            </p>
          </div>
          <IconX onClick={onClose} />
        </div>

        {devCode && (
          <div className="mt-4 border border-black-ink/30 bg-paper-deep px-3 py-2 font-mono text-xs text-black-ink/80">
            DEV MODE — your code is{" "}
            <button type="button" onClick={() => { setDigits(devCode.split("")); }} className="font-bold tracking-[0.3em] text-signal underline decoration-dotted">
              {devCode}
            </button>{" "}
            (click to fill — connect SMTP to send real emails)
          </div>
        )}

        <form onSubmit={submitOtp} className="mt-6">
          <div className="flex justify-between gap-2" role="group" aria-label="6-digit verification code">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { otpRefs.current[i] = el; }}
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => onOtpKey(i, e)}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                maxLength={6}
                aria-label={`digit ${i + 1}`}
                className="otp-box w-full border-[1.5px] border-black-ink bg-transparent pb-2 pt-3 text-center font-mono text-xl font-black text-black-ink caret-signal outline-none placeholder:text-transparent focus:border-signal sm:text-2xl [-moz-appearance:textfield]"
              />
            ))}
          </div>

          {error && <StampError>{error}</StampError>}

          <button type="submit" disabled={busy || digits.join("").length !== 6} className={`btn-print solid mt-6 w-full justify-center ${busy || digits.join("").length !== 6 ? "!cursor-not-allowed !bg-black-ink/40" : ""}`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : "Verify & launch ▸"}
          </button>

          <button type="button" onClick={resend} disabled={cooldown > 0} className="caption-caps mt-4 block w-full text-center text-black-ink/55 transition-colors hover:text-signal disabled:cursor-not-allowed disabled:hover:text-black-ink/55">
            {cooldown > 0 ? `RESEND AVAILABLE IN ${cooldown}S` : "DIDN'T GET IT? RESEND CODE"}
          </button>
          <button type="button" onClick={() => { setStep("form"); setError(null); }} className="caption-caps mt-2 block w-full text-center text-black-ink/45 hover:text-black-ink">
            ← WRONG ADDRESS? GO BACK
          </button>
        </form>
      </Frame>
    );
  }

  /* ── sign in / sign up ── */
  return (
    <Frame onClose={onClose} innerRef={frame} titleId="cc-auth-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="caption-caps font-bold">IDENTITY CARD — N° 04</p>
          <h2 id="cc-auth-title" className="display-caps mt-2 text-3xl md:text-4xl">{mode === "signin" ? "Welcome back" : "Print your pass"}</h2>
          <p className="mt-2 text-[13px] leading-5 text-black-ink/70">
            {mode === "signin" ? "Sign in to enter your city." : "Free forever for public repositories."}
          </p>
        </div>
        <IconX onClick={onClose} />
      </div>

      {/* oauth — flat print chips */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        {(["google", "github"] as const).map((p) => (
          <button key={p} type="button" onClick={() => oauthClick(p)} disabled={!!oauthBusy} className="btn-print ghost !justify-center !py-3">
            {oauthBusy === p ? <Loader2 size={13} className="animate-spin" /> : p === "google" ? <GoogleGlyph /> : <GitHubGlyph />}
            <span className="ml-1">{p === "google" ? "Google" : "GitHub"}</span>
          </button>
        ))}
      </div>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-black-ink/25" />
        <span className="caption-caps text-black-ink/50">OR WITH EMAIL</span>
        <span className="h-px flex-1 bg-black-ink/25" />
      </div>

      {/* mode tabs */}
      <div className="grid grid-cols-2 border-[1.5px] border-black-ink" role="tablist">
        {(["signin", "signup"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className={`caption-caps py-2.5 font-bold transition-colors duration-75 ${mode === m ? "bg-black-ink text-paper" : "bg-transparent hover:bg-black-ink/10"}`}
          >
            {m === "signin" ? "SIGN IN" : "REGISTER"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        {mode === "signup" && (
          <PrintField icon={<UserIcon size={14} />} label="NAME" value={name} onChange={setName} placeholder="Ada Lovelace" autoComplete="name" autoFocus />
        )}
        <PrintField icon={<AtSign size={14} />} label="EMAIL" value={email} onChange={setEmail} placeholder="you@dev.com" type="email" required autoComplete="email" autoFocus={mode === "signin"} />
        <div className="relative">
          <PrintField
            icon={<KeyRound size={14} />}
            label="PASSWORD"
            value={password}
            onChange={setPassword}
            placeholder={mode === "signup" ? "6+ characters" : "••••••••"}
            type={showPw ? "text" : "password"}
            required
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
          <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "hide password" : "show password"} className="absolute bottom-2.5 right-1 p-1 text-black-ink/45 hover:text-black-ink">
            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>

        {error && <StampError>{error}</StampError>}

        <button type="submit" disabled={busy} className="btn-print solid w-full justify-center py-4">
          {busy ? <><Loader2 size={13} className="animate-spin" /> PRINTING…</> : mode === "signin" ? "Sign in & continue ▸" : "Send verification code ▸"}
        </button>
      </form>

      <p className="caption-caps mt-5 leading-relaxed text-black-ink/45">
        PASSWORDS BCRYPT-HASHED · EMAIL VERIFIED BY CODE · NOTHING TRACKED
      </p>
    </Frame>
  );
}

/* ── shared pieces ───────────────────────────────────────────────── */

function Frame({
  children,
  onClose,
  innerRef,
  titleId,
}: {
  children: ReactNode;
  onClose: () => void;
  innerRef: React.RefObject<HTMLDivElement | null>;
  titleId: string;
}) {
  // Esc closes · focus lands on the first control · Tab is TRAPPED inside
  // the card (aria-modal must mean it)
  useEffect(() => {
    const el = innerRef.current;
    el?.querySelector<HTMLElement>("input,button")?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const focusables = Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((n) => n.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [innerRef, onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black-ink/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={innerRef}
        onClick={(e) => e.stopPropagation()}
        className="auth-card relative my-auto w-full max-w-md border-[1.5px] border-black-ink bg-paper p-6 shadow-[8px_8px_0_rgba(20,20,20,0.35)] md:p-7"
      >
        <span aria-hidden className="misreg absolute -right-2 -top-2 h-6 w-6 rounded-full bg-signal" />
        {children}
      </div>
    </div>
  );
}

function IconX({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="close" className="-mr-1 -mt-1 border border-transparent p-1.5 text-black-ink/50 transition-colors hover:border-black-ink hover:text-black-ink">
      <X size={15} />
    </button>
  );
}

function PrintField({
  icon, label, value, onChange, placeholder, type = "text", required, autoComplete, autoFocus,
}: {
  icon: ReactNode; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean; autoComplete?: string; autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="caption-caps mb-1 block font-bold text-black-ink/60">{label}</span>
      <span className="flex items-center gap-2 border-b-[1.5px] border-black-ink transition-colors focus-within:border-signal">
        <span className="text-black-ink/45">{icon}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={type}
          required={required}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={false}
          className="w-full bg-transparent py-2 pr-7 text-sm text-black-ink outline-none placeholder:text-black-ink/35"
        />
      </span>
    </label>
  );
}

function StampError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="auth-stamp mt-4 inline-block border-2 border-signal px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wide text-signal">
      ✕ {children}
    </p>
  );
}

function GoogleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 35.4 44 30.2 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

function GitHubGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
