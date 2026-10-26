const { version: currentVersion } = require('../package.json');
const releasesUrl = 'https://github.com/Morainet/HexoStudio/releases';
const apiUrl = 'https://api.github.com/repos/Morainet/HexoStudio/releases/latest';

function parseVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  return match && { numbers: match.slice(1, 4).map(BigInt), prerelease: Boolean(match[4]) };
}
function isNewerRelease(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b || a.prerelease) return false;
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index];
  }
  return b.prerelease;
}

// Shared per process: opening multiple tabs must not exhaust GitHub's public API quota.
function createUpdateChecker({ fetchImpl = globalThis.fetch, now = Date.now, version = currentVersion } = {}) {
  let cached, expires = 0, pending;
  return function checkUpdates() {
    if (cached && now() < expires) return Promise.resolve(cached);
    if (pending) return pending;
    pending = (async () => {
      const result = { currentVersion: version, latestVersion: null, releasesUrl, releaseUrl: releasesUrl, status: 'unavailable', checkedAt: new Date(now()).toISOString() };
      try {
        const response = await fetchImpl(apiUrl, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'HexoStudio-update-check', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: AbortSignal.timeout(5000), redirect: 'error'
        });
        if (response.status === 404) result.status = 'no-release';
        else {
          if (!response.ok) throw new Error('Release check failed');
          const release = await response.json();
          const parsed = typeof release.tag_name === 'string' && parseVersion(release.tag_name);
          if (!parsed || parsed.prerelease || release.draft || release.prerelease) throw new Error('Invalid stable release');
          result.latestVersion = release.tag_name.replace(/^v/, '');
          result.releaseUrl = `${releasesUrl}/tag/${encodeURIComponent(release.tag_name)}`;
          result.status = isNewerRelease(release.tag_name, version) ? 'available' : 'current';
        }
      } catch { /* Offline, API limits and malformed responses are not "up to date". */ }
      cached = result;
      expires = now() + (result.status === 'unavailable' ? 30_000 : 60_000);
      return result;
    })().finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { createUpdateChecker, isNewerRelease, checkUpdates: createUpdateChecker() };
