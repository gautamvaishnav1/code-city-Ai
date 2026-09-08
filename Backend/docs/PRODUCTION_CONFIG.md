# Production Configuration Guide

Where to find **every** credential referenced in `.env.example` — exact URLs, step-by-step.
Copy this file's values into `Backend/.env` when deploying.

---

## 1. GitHub Token (`GITHUB_TOKEN`) — repo download rate limit

**Where:** https://github.com/settings/tokens → **Generate new token → Generate new token (classic)**

| Step | Action |
|---|---|
| 1 | Log in to GitHub → open https://github.com/settings/tokens |
| 2 | Click **Generate new token (classic)** |
| 3 | Note field: `codecity-repo-scan` (anything descriptive) |
| 4 | Expiration: 90 days / no expiration (your choice) |
| 5 | **Scopes: leave ALL unchecked** — public repo analysis needs zero scopes |
| 6 | Click **Generate token** → copy the `ghp_...` value |

```ini
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> Without a token you get **60 requests/hour**; with it, **5,000/hour**. Strongly recommended in production.

---

## 2. GitHub OAuth (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`)

**Where:** https://github.com/settings/developers → **New OAuth App**

| Field | Value |
|---|---|
| Application name | `CodeCity AI` |
| Homepage URL | `https://your-domain.com` (your frontend) |
| Callback URL | `https://api.your-domain.com/api/v1/auth/github/callback` |

After registering:
- **Client ID** is shown on the app page → `GITHUB_CLIENT_ID`
- Click **Generate a new client secret** → copy once → `GITHUB_CLIENT_SECRET`

> The callback path must be exactly `/api/v1/auth/github/callback`, prefixed by your `PUBLIC_BASE_URL`.
> Local dev equivalent: `http://localhost:5000/api/v1/auth/github/callback`.

---

## 3. Google OAuth (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)

**Where:** https://console.cloud.google.com/apis/credentials

1. Create/select a project → **Credentials → Create credentials → OAuth client ID**
2. Type: **Web application**
3. Authorized redirect URIs: `https://api.your-domain.com/api/v1/auth/google/callback`
4. Copy Client ID / Client Secret into the env file.

---

## 4. SMTP (`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`)

Used only to email OTP codes during signup/password reset. Pick **one** provider below.

### Option A — Gmail (free, quick)

| Env | Value | Where to get it |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | fixed |
| `SMTP_PORT` | `587` | fixed |
| `SMTP_USER` | `you@gmail.com` | your Gmail address |
| `SMTP_PASS` | 16-character **App Password** | see below |

**App Password steps (required — normal passwords are rejected):**
1. Enable 2-Step Verification: https://myaccount.google.com/security
2. Go to https://myaccount.google.com/apppasswords
3. Name: `codecity-backend` → **Create**
4. Copy the 16-char password (e.g. `abcd efgh ijkl mnop`) — use it **without spaces** as `SMTP_PASS`

### Option B — Brevo (ex-Sendinblue, 300 emails/day free)

| Env | Value | Where |
|---|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` | fixed |
| `SMTP_PORT` | `587` | fixed |
| `SMTP_USER` | login email | https://app.brevo.com/settings/keys/api → SMTP & API tab |
| `SMTP_PASS` | SMTP key | same page → click **Generate new SMTP key** |

### Option C — SendGrid

| Env | Value | Where |
|---|---|---|
| `SMTP_HOST` | `smtp.sendgrid.net` | fixed |
| `SMTP_PORT` | `587` | fixed |
| `SMTP_USER` | `apikey` (literal string) | fixed |
| `SMTP_PASS` | API key starting `SG.` | https://app.sendgrid.com/settings/api_keys → Create API Key (Mail Send permission) |

### Option D — Mailtrap (testing only, fake inbox)

All values from your inbox page at https://mailtrap.io → **Inboxes → SMTP Settings**:
host `sandbox.smtp.mailtrap.io`, port `2525` or `587`, user/pass shown on that page.

### MAIL_FROM

Set to a verified sender, e.g. `MAIL_FROM=CodeCity <no-reply@your-domain.com>`.

> **If all SMTP vars stay empty**, OTP codes are printed to the server console and returned
> as `devCode` in the API response — fine for development, never for production.

---

## 5. LLM API key (`LLM_API_KEY`) — AI architect & chat

Any OpenAI-compatible endpoint works:

| Provider | Get key at | Suggested `LLM_BASE_URL` | Model example |
|---|---|---|---|
| OpenAI | https://platform.openai.com/api-keys | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | https://openrouter.ai/settings/keys | `https://openrouter.ai/api/v1` | `anthropic/claude-3.5-haiku` |
| Groq | https://console.groq.com/keys | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama (local) | none needed | `http://localhost:11434/v1` | `llama3.1` |

Empty key = deterministic heuristic mode (no external calls, still fully functional).

---

## 6. MongoDB Atlas (`MONGO_URI`) — managed production DB

1. Create free cluster: https://www.mongodb.com/cloud/atlas/register
2. **Database Access** → add user + password
3. **Network Access** → allow your server IP (or `0.0.0.0/0` behind a VPC)
4. **Connect → Drivers** → copy the connection string:

```ini
MONGO_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/software-world?retryWrites=true&w=majority
```

---

## 7. Production checklist

```ini
NODE_ENV=production
PORT=5000
JWT_SECRET=<64+ random chars — generate: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
CORS_ORIGINS=https://your-domain.com
PUBLIC_BASE_URL=https://api.your-domain.com
FRONTEND_URL=https://your-domain.com
GITHUB_TOKEN=ghp_...
LLM_API_KEY=sk-...
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
```

- [ ] `JWT_SECRET` changed from placeholder
- [ ] `CORS_ORIGINS` locked to real domains (no `*`)
- [ ] `PUBLIC_BASE_URL` / `FRONTEND_URL` point at production hosts
- [ ] OAuth callback URLs updated in Google Cloud Console + GitHub Developer settings
- [ ] SMTP configured (no `devCode` leaks in responses)
- [ ] MongoDB Atlas user has strong password, IP allowlist tightened

---

*See also: [`API_ENDPOINTS.json`](API_ENDPOINTS.json) · [`API_WORKFLOW.md`](API_WORKFLOW.md)*
