const REPOSITORY_PATH = '/Abbhiishek/vaaniflow/releases/download/';

/**
 * Selects the installer from a GitHub release while ignoring updater metadata.
 * A stable asset name is preferred once the release workflow starts publishing it.
 *
 * @param {unknown} assets
 */
export function findWindowsInstaller(assets) {
  if (!Array.isArray(assets)) return null;

  const installers = assets.filter((asset) => {
    if (!asset || typeof asset !== 'object') return false;
    const name = 'name' in asset ? asset.name : undefined;
    const url = 'browser_download_url' in asset ? asset.browser_download_url : undefined;

    return (
      typeof name === 'string' &&
      typeof url === 'string' &&
      /^Vaani-Setup(?:-[0-9][0-9A-Za-z.-]*)?\.exe$/i.test(name)
    );
  });

  return installers.find((asset) => asset.name === 'Vaani-Setup.exe') ?? installers[0] ?? null;
}

/**
 * Prevents release metadata from turning the endpoint into an open redirect.
 *
 * @param {unknown} value
 */
export function isTrustedGitHubDownload(value) {
  if (typeof value !== 'string') return false;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(REPOSITORY_PATH);
  } catch {
    return false;
  }
}
