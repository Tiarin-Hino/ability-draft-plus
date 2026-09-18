// Upstream: OpenDota's dotaconstants (https://github.com/odota/dotaconstants). The npm
// release lags the repo by weeks, so the build reads the generated JSON straight from
// GitHub (`build/`) at a ref that defaults to master and is recorded in the manifest.

const REPO = 'odota/dotaconstants'
export const FILES = ['abilities', 'hero_abilities', 'heroes', 'aghs_desc']

export function rawUrl(ref, file) {
  return `https://raw.githubusercontent.com/${REPO}/${ref}/build/${file}.json`
}

/** Resolve a branch/tag/sha to the commit sha (best effort — falls back to the ref). */
export async function resolveCommit(ref, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${REPO}/commits/${ref}`, {
      headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'ability-draft-plus-catalog' },
    })
    if (!response.ok) return ref
    return (await response.text()).trim() || ref
  } catch {
    return ref
  }
}

export async function fetchSources(ref, fetchImpl = fetch) {
  const entries = await Promise.all(
    FILES.map(async (file) => {
      const response = await fetchImpl(rawUrl(ref, file))
      if (!response.ok) throw new Error(`Failed to fetch ${file}.json (${response.status})`)
      return [file, await response.json()]
    }),
  )
  return Object.fromEntries(entries)
}
