import { readFile, stat } from 'node:fs/promises';

function normalizeHost(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('apiHost is required');
  const raw = value.trim();
  let url;
  try { url = new URL(raw.includes('://') ? raw : `https://${raw}`); } catch { throw new TypeError('apiHost is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('apiHost must be an HTTPS hostname');
  }
  return url.hostname;
}

export async function loadWeatherCredentials(pathname) {
  const fileStat = await stat(pathname);
  if ((fileStat.mode & 0o077) !== 0) throw new Error('weather credentials permissions must be 0600');
  let value;
  try { value = JSON.parse(await readFile(pathname, 'utf8')); } catch { throw new Error('weather credentials JSON is invalid'); }
  const apiHost = normalizeHost(value?.apiHost);
  if (typeof value?.apiKey !== 'string' || value.apiKey.trim() === '') throw new TypeError('apiKey is required');
  return Object.freeze({ apiHost, apiKey: value.apiKey.trim() });
}
