import assert from 'node:assert/strict';
import test from 'node:test';
import { findWindowsInstaller, isTrustedGitHubDownload } from '../src/lib/release.js';

test('prefers the stable Windows installer asset', () => {
  const asset = findWindowsInstaller([
    {
      name: 'Vaani-Setup-1.0.2.exe',
      browser_download_url: 'https://github.com/Abbhiishek/vaaniflow/releases/download/v1.0.2/Vaani-Setup-1.0.2.exe'
    },
    {
      name: 'Vaani-Setup.exe',
      browser_download_url: 'https://github.com/Abbhiishek/vaaniflow/releases/download/v1.0.2/Vaani-Setup.exe'
    }
  ]);

  assert.equal(asset?.name, 'Vaani-Setup.exe');
});

test('accepts the current versioned installer and ignores updater files', () => {
  const asset = findWindowsInstaller([
    { name: 'latest.yml', browser_download_url: 'https://example.com/latest.yml' },
    {
      name: 'Vaani-Setup-1.0.2.exe.blockmap',
      browser_download_url: 'https://example.com/Vaani-Setup-1.0.2.exe.blockmap'
    },
    {
      name: 'Vaani-Setup-1.0.2.exe',
      browser_download_url: 'https://github.com/Abbhiishek/vaaniflow/releases/download/v1.0.2/Vaani-Setup-1.0.2.exe'
    }
  ]);

  assert.equal(asset?.name, 'Vaani-Setup-1.0.2.exe');
});

test('only trusts download URLs for the VaaniFlow GitHub repository', () => {
  assert.equal(
    isTrustedGitHubDownload(
      'https://github.com/Abbhiishek/vaaniflow/releases/download/v1.0.2/Vaani-Setup-1.0.2.exe'
    ),
    true
  );
  assert.equal(isTrustedGitHubDownload('https://example.com/Vaani-Setup.exe'), false);
  assert.equal(
    isTrustedGitHubDownload('https://github.com/another/repo/releases/download/v1/Vaani-Setup.exe'),
    false
  );
});
