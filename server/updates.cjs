const { version: currentVersion } = require('../package.json');

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
function createUpdateChecker({ fetchImpl = require('./network.cjs').fetchNetwork, now = Date.now, version = currentVersion, repository = 'Morainet/HexoStudio' } = {}) {
  require('./branding.cjs').validateBranding({ releaseRepository: repository });
  const releasesUrl = `https://github.com/${repository}/releases`;
  const apiUrl = `https://api.github.com/repos/${repository}/releases/latest`;
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

const checkers = new Map();
function checkBrandUpdates(branding) {
  const repository = branding.releaseRepository;
  if (!repository) return Promise.resolve({ currentVersion, status: 'disabled', checkedAt: null });
  if (!checkers.has(repository)) {
    if (checkers.size >= 8) checkers.delete(checkers.keys().next().value);
    checkers.set(repository, createUpdateChecker({ repository }));
  }
  return checkers.get(repository)();
}

module.exports = { checkBrandUpdates, createUpdateChecker, isNewerRelease, checkUpdates: createUpdateChecker() };
