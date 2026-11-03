export interface GitHubRepoTarget {
  owner: string
  repo: string
  ref?: string // branch, tag, or commit
}

export function parseGitHubUrl (input: string): GitHubRepoTarget {
  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    throw new Error('Invalid URL')
  }
  if (url.hostname !== 'github.com') {
    throw new Error('Not a GitHub URL')
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) {
    throw new Error('Invalid GitHub URL')
  }

  const owner = parts[0]
  let repo = parts[1]

  if (repo.endsWith('.git')) {
    repo = repo.replace(/\.git$/, '')
  }
  let ref: string | undefined
  if (parts[2] === 'tree' && parts.length >= 4) {
    ref = parts.slice(3).join('/')
  }

  // https://github.com/owner/repo/commit/sha
  if (parts[2] === 'commit' && parts.length >= 4) {
    ref = parts[3]
  }
  return { owner, repo, ref }
}
