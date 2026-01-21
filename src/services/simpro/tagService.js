import axios from 'axios';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

const { baseUrl, apiKey, companyId } = config.simpro;

const axiosInstance = axios.create({
  baseURL: baseUrl,
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

async function tryGet(url) {
  const res = await axiosInstance.get(url);
  return res.data;
}

function normalizeList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.Items)) return raw.Items;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.Tags)) return raw.Tags;
  if (Array.isArray(raw?.tags)) return raw.tags;
  return raw ? [raw] : [];
}

function normalizeTag(t) {
  const id = t?.ID ?? t?.Id ?? t?.id ?? '';
  const name = t?.Name ?? t?.name ?? t?.Tag ?? t?.tag ?? '';
  return { id: id !== null && id !== undefined ? String(id) : '', name: name ? String(name) : '' };
}

export async function findJobTagByName(tagName) {
  const target = String(tagName || '').trim().toLowerCase();
  if (!target) return null;

  // Simpro route shapes vary; probe common locations.
  const candidates = [
    `/companies/${companyId}/jobs/tags/`,
    `/companies/${companyId}/jobs/tags`,
    // Project Tags (often used for Jobs/Projects)
    `/companies/${companyId}/projects/tags/`,
    `/companies/${companyId}/projects/tags`,
    `/companies/${companyId}/tags/`,
    `/companies/${companyId}/tags`,
    `/companies/${companyId}/setup/tags/`,
    `/companies/${companyId}/setup/tags`,
    `/setup/tags/`,
    `/setup/tags`
  ];

  let lastErr = null;
  for (const url of candidates) {
    try {
      const data = await tryGet(url);
      const items = normalizeList(data).map(normalizeTag).filter((x) => x.id && x.name);
      const hit = items.find((x) => x.name.trim().toLowerCase() === target);
      if (hit) return { ...hit, sourceUrl: url, count: items.length };
    } catch (e) {
      lastErr = e;
    }
  }

  // If we can't find it, surface a helpful error for debugging.
  if (lastErr) {
    logger.warn(`Could not find job tag "${tagName}" via probed endpoints: ${lastErr.message}`);
  }
  return null;
}

export async function listJobTags() {
  const candidates = [
    `/companies/${companyId}/jobs/tags/`,
    `/companies/${companyId}/jobs/tags`,
    `/companies/${companyId}/projects/tags/`,
    `/companies/${companyId}/projects/tags`,
    `/companies/${companyId}/tags/`,
    `/companies/${companyId}/tags`
  ];
  for (const url of candidates) {
    try {
      const data = await tryGet(url);
      const items = normalizeList(data).map(normalizeTag).filter((x) => x.id && x.name);
      if (items.length > 0) return { sourceUrl: url, items };
    } catch {
      // continue probing
    }
  }
  return { sourceUrl: null, items: [] };
}

