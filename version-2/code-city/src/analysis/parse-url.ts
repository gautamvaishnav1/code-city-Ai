import { URL } from 'url'

export interface ParsedRepoUrl {
  owner: String
  repo: string
  ref?: string
}

export function parseGitHubUrl (input: string): ParsedRepoUrl {
  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    throw new Error('Invalid URL format')
  }
  if (url.hostname !== 'github.com') {
    throw new Error('only github.com URL is supported')
  }

  const parts = url.pathname.split('/').filter(Boolean)

  if (parts.length < 2) {
    throw new Error('URL must contain their owner and repo name')
  }

  const owner = parts[0]
  if (!owner) {
    throw new Error('URL must contain their GitHub owner name')
  }
  const repo = parts[1].replace(/\.git$/, '')
  let ref: string | undefined

  if (parts[2] === 'tree' && parts.length >= 4) {
    // https://github.com/owner/repo/tree/develop
    ref = parts.slice(3).join('/')
  } else if (parts[2] === 'commit' && parts.length >= 4) {
    // https://github.com/owner/repo/commit/abc123
    ref = parts[3]
  }
  return {owner,repo,ref}
}
