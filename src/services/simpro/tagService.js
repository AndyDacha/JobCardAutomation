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

async function tryOptions(url) {
  const res = await axiosInstance.request({ method: 'options', url });
  return res;
}

async function trySearch(url, data) {
  const res = await axiosInstance.request({ method: 'search', url, data });
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
    // APIDoc hint: sometimes named "projectTags"
    `/companies/${companyId}/projectTags/`,
    `/companies/${companyId}/projectTags`,
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
      // Prefer SEARCH if the endpoint supports it (Simpro uses SEARCH for some resources)
      let allow = '';
      try {
        const opt = await tryOptions(url);
        allow = String(opt?.headers?.allow || '');
      } catch {
        // ignore
      }

      let data = null;
      if (allow.toUpperCase().includes('SEARCH')) {
        // Try common SEARCH payload shapes. If filters aren't supported, a bare SEARCH may return the list.
        const payloads = [
          { SearchTerm: tagName },
          { Filters: [{ Field: 'Name', Operator: 'eq', Value: tagName }] },
          { filters: [{ field: 'Name', operator: 'eq', value: tagName }] },
          {}
        ];
        for (const p of payloads) {
          try {
            data = await trySearch(url, p);
            break;
          } catch (e) {
            lastErr = e;
          }
        }
      } else {
        data = await tryGet(url);
      }

      const items = normalizeList(data).map(normalizeTag).filter((x) => x.id && x.name);
      const hit = items.find((x) => x.name.trim().toLowerCase() === target);
      if (hit) return { ...hit, sourceUrl: url, count: items.length, allow };
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
    `/companies/${companyId}/projectTags/`,
    `/companies/${companyId}/projectTags`,
    `/companies/${companyId}/tags/`,
    `/companies/${companyId}/tags`
  ];
  for (const url of candidates) {
    try {
      let data = null;
      let allow = '';
      try {
        const opt = await tryOptions(url);
        allow = String(opt?.headers?.allow || '');
      } catch {
        // ignore
      }

      if (allow.toUpperCase().includes('SEARCH')) {
        try {
          data = await trySearch(url, {});
        } catch {
          data = await tryGet(url);
        }
      } else {
        data = await tryGet(url);
      }
      const items = normalizeList(data).map(normalizeTag).filter((x) => x.id && x.name);
      if (items.length > 0) return { sourceUrl: url, allow, items };
    } catch {
      // continue probing
    }
  }
  return { sourceUrl: null, allow: '', items: [] };
}

