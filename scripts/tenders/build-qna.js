import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function normalizeBullets(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u2022/g, '●')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toMarkdown(s) {
  // Convert "●" bullets into markdown list items, keep paragraphs.
  const txt = normalizeBullets(s);
  if (!txt) return '';
  // Put bullets onto new lines, then convert.
  const withLines = txt.replace(/\s*●\s*/g, '\n- ');
  return withLines.replace(/\n{3,}/g, '\n\n').trim();
}

function parseQFromText(text) {
  const raw = normalizeBullets(text);
  const split = raw.split(/\n?-{8,}\n?/); // dashed separator line
  const head = (split[0] || '').trim();
  const body = split.slice(1).join('\n\n').trim();

  // Extract Q number (e.g., "Q2")
  const m = head.match(/\bQ(\d+)\b/i);
  const qNum = m ? m[1] : '';
  const qId = qNum ? `Q${qNum}` : '';

  // Attempt a title: text immediately after "Qx" up to "The Tenderer" or "Scenario"
  let title = '';
  if (qId) {
    const after = head.split(new RegExp(`\\b${qId}\\b`, 'i'))[1] || '';
    const cut = after.split(/The Tenderer|Scenario/i)[0] || after;
    title = cut.replace(/^[\s:.-]+/, '').trim();
    // Remove leading "Quality Questionnaire" noise
    title = title.replace(/^Resources\b/i, 'Resources').trim();
  }

  return {
    qId,
    title: title || qId || 'Unknown',
    questionText: head,
    responseText: body
  };
}

function pickEastRidingStatements(extractDir) {
  const files = walk(extractDir).filter((f) => f.toLowerCase().endsWith('.txt'));
  return files.filter((f) => {
    const n = path.basename(f);
    return (
      n.includes('East_Riding_of_Yorkshire__Dacha_Replies__Dacha_SSI_East_Riding_Statement') &&
      n.includes('_-_Q') &&
      n.endsWith('.pdf.txt')
    );
  });
}

function groupEvidence(extractDir) {
  const files = walk(extractDir).filter((f) => f.toLowerCase().endsWith('.txt'));
  const evidence = files.filter((f) => f.includes('East_Riding_of_Yorkshire__Dacha_Replies__') && !f.includes('Statement_Volume_2_-_Q'));
  return evidence.map((f) => ({ file: path.basename(f), chars: fs.readFileSync(f, 'utf8').length }));
}

async function main() {
  const extractDir = process.argv[2] || path.join(__dirname, '../../tender-extract');
  const outDir = process.argv[3] || path.join(__dirname, '../../tender-qna/east-riding-52870');

  if (!fs.existsSync(extractDir)) {
    throw new Error(`extractDir not found: ${extractDir}. Run scripts/tenders/extract-text.js first.`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const statementFiles = pickEastRidingStatements(extractDir);
  const items = statementFiles
    .map((f) => {
      const text = fs.readFileSync(f, 'utf8');
      const parsed = parseQFromText(text);
      return {
        qId: parsed.qId,
        title: parsed.title,
        sourceExtractFile: path.basename(f),
        question: parsed.questionText,
        response: parsed.responseText
      };
    })
    .filter((x) => x.qId)
    .sort((a, b) => Number(a.qId.replace('Q', '')) - Number(b.qId.replace('Q', '')));

  const evidence = groupEvidence(extractDir)
    .sort((a, b) => b.chars - a.chars)
    .map((e) => ({ file: e.file, chars: e.chars }));

  const jsonPath = path.join(outDir, 'qna.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ tender: 'East Riding of Yorkshire - Project 52870', items, evidence }, null, 2), 'utf8');

  const mdParts = [];
  mdParts.push(`# Tender Response Pack (Draft)\n`);
  mdParts.push(`**Tender:** East Riding of Yorkshire – Project 52870\n`);
  mdParts.push(`## Quality Statements\n`);
  for (const it of items) {
    mdParts.push(`### ${it.qId} — ${it.title}\n`);
    mdParts.push(`#### Question / Requirements\n`);
    mdParts.push(toMarkdown(it.question) + '\n');
    mdParts.push(`#### Dacha Response (template)\n`);
    mdParts.push(toMarkdown(it.response) + '\n');
  }

  mdParts.push(`## Evidence / Supporting Documents (detected)\n`);
  for (const e of evidence) {
    mdParts.push(`- ${e.file}\n`);
  }

  const mdPath = path.join(outDir, 'response-pack.md');
  fs.writeFileSync(mdPath, mdParts.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`Wrote ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${mdPath}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

