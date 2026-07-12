import type { APIRoute } from 'astro';
import { findWindowsInstaller, isTrustedGitHubDownload } from '../../../lib/release.js';

export const prerender = false;

const RELEASE_API = 'https://api.github.com/repos/Abbhiishek/vaaniflow/releases/latest';
const RELEASES_PAGE = 'https://github.com/Abbhiishek/vaaniflow/releases/latest';

const cacheHeaders = {
  'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
  'X-Content-Type-Options': 'nosniff'
};

function redirect(location: string) {
  return new Response(null, {
    status: 307,
    headers: {
      ...cacheHeaders,
      Location: location
    }
  });
}

export const GET: APIRoute = async () => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VaaniFlow-Website',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  if (import.meta.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${import.meta.env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(RELEASE_API, { headers });
    if (!response.ok) return redirect(RELEASES_PAGE);

    const release = await response.json();
    const installer = findWindowsInstaller(release?.assets);
    const downloadUrl = installer?.browser_download_url;

    if (!isTrustedGitHubDownload(downloadUrl)) return redirect(RELEASES_PAGE);
    return redirect(downloadUrl);
  } catch {
    return redirect(RELEASES_PAGE);
  }
};
