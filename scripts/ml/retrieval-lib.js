export function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

export function scoreDocForRequirement(reqTokens, doc) {
  const docTokens = new Set([...(doc.keywords || [])]);
  let overlap = 0;
  for (const t of reqTokens) if (docTokens.has(t)) overlap += 1;

  // Doc-type priors: help retrieval even when filenames are sparse.
  const req = reqTokens.join(' ');
  let prior = 0;
  const dt = String(doc.doc_type || '').toUpperCase();

  const wantsISO = req.includes('iso') || req.includes('isms') || req.includes('information security');
  const wantsSSAIB = req.includes('ssaib') || req.includes('nsi');
  const wantsInsurance = req.includes('insurance') || req.includes('liability') || req.includes('indemnity');
  const wantsHS = req.includes('health') || req.includes('safety') || req.includes('rams');

  if (wantsISO && (dt === 'ISO9001' || dt === 'ISO14001' || dt === 'ISO27001' || dt === 'ISMS')) prior += 10;
  if (wantsSSAIB && dt === 'SSAIB_NSI') prior += 12;
  if (wantsInsurance && dt === 'INSURANCE') prior += 12;
  if (wantsHS && dt === 'HS_POLICY') prior += 10;

  return prior + overlap;
}

