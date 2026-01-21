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

async function tryGetWithMeta(url, config = {}) {
  const res = await axiosInstance.get(url, config);
  return { status: res.status, headers: res.headers, data: res.data };
}

async function tryOptions(url) {
  const res = await axiosInstance.request({ method: 'options', url });
  return res;
}

async function trySearch(url, data) {
  const res = await axiosInstance.request({ method: 'SEARCH', url, data });
  return res.data;
}

async function getAllPages({ url, pageSize = 250 }) {
  const all = [];
  for (let page = 1; page < 200; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const pageUrl = `${url}${sep}pageSize=${pageSize}&page=${page}`;
    const data = await tryGet(pageUrl);
    const items = normalizeList(data);
    if (!Array.isArray(items) || items.length === 0) break;
    all.push(...items);
    if (items.length < pageSize) break;
  }
  return all;
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
    // Confirmed by you (Project Tags under setup) - likely paginated
    `/companies/${companyId}/setup/tags/projects/`,
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
      if (url.includes('/setup/tags/projects/')) {
        // Setup project tags are paginated lists
        const raw = await getAllPages({ url });
        data = raw;
      } else if (allow.toUpperCase().includes('SEARCH')) {
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
    `/companies/${companyId}/setup/tags/projects/`,
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

      if (url.includes('/setup/tags/projects/')) {
        data = await getAllPages({ url });
      } else if (allow.toUpperCase().includes('SEARCH')) {
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

export async function probeTagEndpoints() {
  const candidates = [
    `/companies/${companyId}/setup/tags/projects/`,
    `/companies/${companyId}/jobs/tags/`,
    `/companies/${companyId}/jobs/tags`,
    `/companies/${companyId}/projects/tags/`,
    `/companies/${companyId}/projects/tags`,
    `/companies/${companyId}/projectTags/`,
    `/companies/${companyId}/projectTags`,
    `/companies/${companyId}/tags/`,
    `/companies/${companyId}/tags`,
    `/companies/${companyId}/setup/tags/`,
    `/companies/${companyId}/setup/tags`,
    `/setup/tags/`,
    `/setup/tags`
  ];

  const results = [];
  for (const url of candidates) {
    const entry = { url, options: null, search: null, get: null };

    try {
      const opt = await tryOptions(url);
      entry.options = { status: opt.status, allow: String(opt.headers?.allow || '') };
    } catch (e) {
      entry.options = { status: e?.response?.status ?? null, error: e?.message || '', allow: String(e?.response?.headers?.allow || '') };
    }

    // SEARCH probe with empty body
    try {
      const data = await trySearch(url, {});
      const items = normalizeList(data).map(normalizeTag).filter((x) => x.id && x.name);
      entry.search = { ok: true, count: items.length, sample: items.slice(0, 15) };
    } catch (e) {
      entry.search = { ok: false, status: e?.response?.status ?? null, data: e?.response?.data || null, error: e?.message || '' };
    }

    // GET probe (some endpoints use GET)
    try {
      const data = await tryGet(url);
      const items = normalizeList(data).map(normalizeTag).filter((x) => x.id && x.name);
      entry.get = { ok: true, count: items.length, sample: items.slice(0, 15) };
    } catch (e) {
      entry.get = { ok: false, status: e?.response?.status ?? null, data: e?.response?.data || null, error: e?.message || '' };
    }

    results.push(entry);
  }

  return results;
}

export async function listTagsForJob(jobId) {
  const jid = encodeURIComponent(String(jobId));
  const candidates = [
    `/companies/${companyId}/jobs/${jid}/tags/`,
    `/companies/${companyId}/jobs/${jid}/tags`,
    `/companies/${companyId}/projects/${jid}/tags/`,
    `/companies/${companyId}/projects/${jid}/tags`,
    `/companies/${companyId}/projects/${jid}/projectTags/`,
    `/companies/${companyId}/projects/${jid}/projectTags`,
    `/companies/${companyId}/jobs/${jid}/projectTags/`,
    `/companies/${companyId}/jobs/${jid}/projectTags`
  ];

  const attempts = [];
  for (const url of candidates) {
    let allow = '';
    try {
      const opt = await tryOptions(url);
      allow = String(opt?.headers?.allow || '');
    } catch {
      // ignore
    }

    try {
      const data = await tryGet(url);
      const items = normalizeList(data).map(normalizeTag).filter((x) => x.id && x.name);
      return { sourceUrl: url, allow, items, attempts };
    } catch (e) {
      attempts.push({
        url,
        allow,
        status: e?.response?.status ?? null,
        data: e?.response?.data || null,
        error: e?.message || ''
      });
    }
  }

  return { sourceUrl: null, allow: '', items: [], attempts };
}

export async function debugFetchProjectTags() {
  const url = `/companies/${companyId}/setup/tags/projects/`;
  const tries = [];

  const configs = [
    { label: 'no-params', config: {} },
    { label: 'page1-size50', config: { params: { page: 1, pageSize: 50 } } },
    { label: 'page1-size250', config: { params: { page: 1, pageSize: 250 } } },
    { label: 'page2-size250', config: { params: { page: 2, pageSize: 250 } } }
  ];

  for (const c of configs) {
    try {
      const res = await tryGetWithMeta(url, c.config);
      const list = normalizeList(res.data).map(normalizeTag).filter((x) => x.id && x.name);
      tries.push({
        label: c.label,
        ok: true,
        status: res.status,
        link: res.headers?.link || res.headers?.Link || null,
        total: res.headers?.['x-total-count'] || res.headers?.['X-Total-Count'] || null,
        count: list.length,
        sample: list.slice(0, 15)
      });
    } catch (e) {
      tries.push({
        label: c.label,
        ok: false,
        status: e?.response?.status ?? null,
        data: e?.response?.data || null,
        message: e?.message || ''
      });
    }
  }

  return { url, tries };
}

