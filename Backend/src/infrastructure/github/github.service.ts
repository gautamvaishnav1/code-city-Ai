import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ApiError } from "../../shared/utils/api-error";
import { logger } from "../../shared/utils/logger";
import { env } from "../../config/env";
import { parseGitHubUrl, type ParsedRepoUrl } from "../../modules/repository/repo-url.util";

const execFileAsync = promisify(execFile);

export interface RepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  description?: string;
  defaultBranch: string;
  primaryLanguage?: string;
  stars: number;
  isPrivate: boolean;
  htmlUrl: string;
}

const GITHUB_API = "https://api.github.com";
/** Hard cap on the downloaded tarball to prevent OOM/disk-fill DoS. */
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024; // 200 MB
/** execFile maxBuffer for tar/git stdout+stderr (default 1 MB is too small for git clone progress). */
const EXEC_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

function githubHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "software-world-mvp",
    ...extra
  };
  if (env.githubToken) headers.Authorization = `Bearer ${env.githubToken}`;
  return headers;
}

async function fetchJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(20_000)
    });
  } catch (err) {
    throw ApiError.badGateway(
      "GitHub API unreachable",
      err instanceof Error ? err.message : undefined
    );
  }
  if (res.status === 404) {
    throw ApiError.notFound("GitHub repository not found (or private without a token)");
  }
  if (res.status === 403 || res.status === 429) {
    throw ApiError.tooManyRequests(
      "GitHub API rate limit exceeded. Set GITHUB_TOKEN in .env to raise limits."
    );
  }
  if (!res.ok) {
    throw ApiError.badGateway(`GitHub API error (${res.status})`);
  }
  return (await res.json()) as T;
}

interface GithubRepoApiResponse {
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  private: boolean;
  html_url: string;
}

export function parseRepoUrl(url: string): ParsedRepoUrl {
  return parseGitHubUrl(url);
}

export async function getRepoInfo(repoUrl: string): Promise<RepoInfo> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const data = await fetchJson<GithubRepoApiResponse>(`${GITHUB_API}/repos/${owner}/${repo}`);
  return {
    owner,
    repo,
    fullName: data.full_name,
    description: data.description ?? undefined,
    defaultBranch: data.default_branch ?? "main",
    primaryLanguage: data.language ?? undefined,
    stars: data.stargazers_count ?? 0,
    isPrivate: Boolean(data.private),
    htmlUrl: data.html_url
  };
}

/**
 * Downloads the repository tarball and extracts it into a fresh temp dir.
 * Returns the directory containing the repo ROOT files.
 */
export async function downloadAndExtractRepo(
  repoUrl: string,
  analysisId: string,
  branchHint?: string
): Promise<{ dir: string; info: RepoInfo; cleanedUp: () => Promise<void> }> {
  const info = await getRepoInfo(repoUrl);
  const branch = branchHint || info.defaultBranch;

  const workRoot = path.join(os.tmpdir(), `software-world-${analysisId}`);
  const extractDir = path.join(workRoot, "repo");
  const tarPath = path.join(workRoot, "repo.tar.gz");
  fs.mkdirSync(extractDir, { recursive: true });

  const url = `https://codeload.github.com/${info.owner}/${info.repo}/tar.gz/refs/heads/${branch}`;

  let buffer: Buffer | null = null;
  try {
    const res = await fetch(url, {
      // codeload accepts the same bearer token as api.github.com
      headers: githubHeaders(),
      signal: AbortSignal.timeout(60_000)
    });
    if (res.ok && res.body) {
      // Reject oversized archives before buffering them in memory
      const contentLength = Number(res.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
        logger.warn("Repository archive exceeds size cap; falling back to git clone", {
          bytes: contentLength,
          cap: MAX_ARCHIVE_BYTES
        });
      } else {
        buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > MAX_ARCHIVE_BYTES) {
          logger.warn("Downloaded archive exceeds size cap; falling back to git clone", {
            bytes: buffer.length,
            cap: MAX_ARCHIVE_BYTES
          });
          buffer = null;
        } else if (buffer.length < 200) {
          logger.warn("Downloaded repository archive looks empty; will try git clone");
          buffer = null;
        }
      }
    } else if (res.status !== 404) {
      logger.warn(`GitHub codeload error (${res.status}); will try git clone`);
    }
  } catch (err) {
    logger.warn("codeload fetch failed; falling back to git clone", {
      repo: info.fullName,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  if (buffer) {
    // Validate gzip magic bytes (0x1f 0x8b) to catch non-gzip responses
    if (buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
      logger.warn("Downloaded file is not valid gzip; falling back to git clone");
      buffer = null;
    }
  }

  if (buffer) {
    try {
      fs.writeFileSync(tarPath, buffer);
    } catch (err) {
      // Clean up the temp dir before rethrowing — otherwise it leaks forever
      fs.rmSync(workRoot, { recursive: true, force: true });
      throw ApiError.internal(
        `Failed to write repository archive to disk: ${err instanceof Error ? err.message : err}`
      );
    }
    // System bsdtar ships with Windows 10+/macOS/Linux — zero extra deps.
    try {
      await execFileAsync("tar", ["-xzf", tarPath, "-C", extractDir, "--strip-components=1"], {
        timeout: 60_000,
        windowsHide: true,
        maxBuffer: EXEC_MAX_BUFFER
      });
    } catch (err) {
      // If tar fails, clean up and fall back to git clone instead of throwing
      logger.warn("tar extraction failed; falling back to git clone", {
        message: err instanceof Error ? err.message : err
      });
      fs.rmSync(extractDir, { recursive: true, force: true });
      fs.mkdirSync(extractDir, { recursive: true });
      try {
        fs.unlinkSync(tarPath);
      } catch {
        /* ignore */
      }
      await cloneViaGit(info, branch, extractDir, workRoot);
      buffer = null; // mark as handled by git clone — skip the fallback below
    } finally {
      try {
        fs.unlinkSync(tarPath);
      } catch {
        /* ignore */
      }
    }
  } else {
    // Fallback: shallow git clone over HTTPS (different host/stack than codeload,
    // so it survives codeload outages and some corporate-network filters).
    await cloneViaGit(info, branch, extractDir, workRoot);
  }

  const cleanedUp = async (): Promise<void> => {
    try {
      fs.rmSync(workRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  logger.info("Repository downloaded", { repo: info.fullName, branch, bytes: buffer?.length ?? 0 });
  return { dir: extractDir, info, cleanedUp };
}

/** Shallow single-branch clone; never leaks the token into thrown messages. */
async function cloneViaGit(info: RepoInfo, branch: string, extractDir: string, workRoot: string): Promise<void> {
  fs.rmSync(extractDir, { recursive: true, force: true }); // git clone needs a fresh target
  const cloneUrl = env.githubToken
    ? `https://x-access-token:${env.githubToken}@github.com/${info.owner}/${info.repo}.git`
    : `https://github.com/${info.owner}/${info.repo}.git`;

  try {
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--single-branch", "--branch", branch, cloneUrl, extractDir],
      {
        timeout: 120_000,
        windowsHide: true,
        maxBuffer: EXEC_MAX_BUFFER,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      }
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    logger.error("git clone fallback failed", { repo: info.fullName, error: redact(raw) });
    fs.rmSync(workRoot, { recursive: true, force: true });
    if (/not found|Remote branch .* not found/i.test(raw)) {
      throw ApiError.notFound(`Branch "${branch}" not found on ${info.fullName}`);
    }
    throw ApiError.badGateway(
      `Failed to download repository archive for ${info.fullName}@${branch} (archive + git clone both failed)`
    );
  }
}

function redact(input: string): string {
  return env.githubToken ? input.split(env.githubToken).join("***") : input;
}

/**
 * Removes leftover `software-world-*` work dirs (repo downloads / git clones)
 * that a crashed or restarted process never cleaned up. Safe to call at boot:
 * no analysis is in flight yet, so any such dir under the OS temp dir is orphaned.
 * Returns how many dirs were removed.
 */
export function cleanupStaleWorkDirs(maxAgeMs = 60 * 60 * 1000): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(os.tmpdir());
  } catch {
    return 0;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith("software-world-")) continue;
    const full = path.join(os.tmpdir(), name);
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs >= maxAgeMs) {
        fs.rmSync(full, { recursive: true, force: true });
        removed++;
      }
    } catch {
      /* a concurrently-running analysis may be touching it — skip */
    }
  }
  return removed;
}

/**
 * Reports the git/tar versions at boot so production logs prove the clone
 * toolchain is present BEFORE the first analysis runs. `git` backs the
 * shallow-clone fallback (used whenever the tarball download/extract fails);
 * without it that path breaks silently until an analysis needs it. Non-fatal:
 * logs a warning when a tool is missing instead of refusing to start.
 */
export async function logCloneToolchain(): Promise<void> {
  const version = async (cmd: string): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync(cmd, ["--version"], {
        timeout: 10_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      return stdout.trim().split("\n")[0] ?? null;
    } catch {
      return null;
    }
  };

  const [gitVersion, tarVersion] = await Promise.all([version("git"), version("tar")]);

  logger.info("Clone toolchain", {
    git: gitVersion ?? "MISSING",
    tar: tarVersion ?? "MISSING"
  });

  if (!gitVersion) {
    logger.warn(
      "git is NOT available — the shallow-clone fallback will fail if the tarball download/extract path also fails. " +
        "In Docker, install it in the runtime image: apk add --no-cache git"
    );
  }
  if (!tarVersion) {
    logger.warn("tar is NOT available — repository tarball extraction will always fall back to git clone.");
  }
}
