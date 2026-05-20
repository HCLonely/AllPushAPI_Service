import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const srcPath = join(root, 'README.md');
const outDir = resolve(root, '..', 'web', 'public');
const outPath = join(outDir, 'api-docs.generated.html');

if (!existsSync(srcPath)) {
  console.error(`Missing README: ${srcPath}`);
  process.exit(1);
}

const md = readFileSync(srcPath, 'utf-8');

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function convertMarkdownToHtml(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  let inTable = false;
  let tableRows = [];

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // code block
    const cbm = line.match(/^```(\w*)/);
    if (cbm) {
      if (inTable) { flushTable(); }
      const lang = cbm[1] || '';
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      out.push(`<pre><code class="language-${lang}">${codeLines.join('\n')}</code></pre>`);
      i++; // skip closing ```
      continue;
    }

    // horizontal rule
    if (/^-{3,}\s*$/.test(line)) {
      if (inTable) { flushTable(); }
      out.push('<hr>');
      i++;
      continue;
    }

    // heading
    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      if (inTable) { flushTable(); }
      const level = hm[1].length;
      const text = processInline(hm[2]);
      const id = hm[2].toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/(^-|-$)/g, '');
      out.push(`<h${level} id="${id}">${text}</h${level}>`);
      i++;
      continue;
    }

    // table
    if (line.startsWith('|') && line.endsWith('|')) {
      if (i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())) {
        // header+separator pair
        inTable = true;
        tableRows = [];
        tableRows.push(line);
        i++;
        continue; // separator skipped in flush
      } else if (inTable || (i > 0 && /^\|[\s\-:|]+\|$/.test(line))) {
        // separator or continuation — skip separator, collect data row
        if (!/^\|[\s\-:|]+\|$/.test(line)) {
          tableRows.push(line);
        }
        i++;
        continue;
      }
    }

    // blank line
    if (line === '') {
      if (inTable) { flushTable(); }
      i++;
      continue;
    }

    if (inTable) { flushTable(); }

    // unordered list item
    if (/^\s*[-*+]\s+/.test(line)) {
      out.push(`<ul><li>${processInline(line.replace(/^\s*[-*+]\s+/, ''))}</li></ul>`);
      i++;
      continue;
    }

    // paragraph
    out.push(`<p>${processInline(line)}</p>`);
    i++;
  }

  if (inTable) { flushTable(); }

  function flushTable() {
    if (tableRows.length === 0) { inTable = false; return; }
    const headerRow = tableRows[0];
    const bodyRows = tableRows.slice(1);
    const headers = headerRow.split('|').filter(Boolean).map(c => c.trim());
    const colAligns = [];
    // parse separator line if available (already consumed)
    // default all left
    for (let ci = 0; ci < headers.length; ci++) colAligns.push('left');

    let html = '<table><thead><tr>';
    for (const h of headers) {
      html += `<th>${processInline(h)}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (const row of bodyRows) {
      const cells = row.split('|').filter(Boolean).map(c => c.trim());
      html += '<tr>';
      for (let ci = 0; ci < headers.length; ci++) {
        const cell = cells[ci] || '';
        html += `<td>${processInline(cell)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    out.push(html);
    tableRows = [];
    inTable = false;
  }

  function processInline(s) {
    // escape first
    let html = escapeHtml(s);
    // inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return html;
  }

  return out.join('\n');
}

const bodyHtml = convertMarkdownToHtml(md);

const fullHtml = `<article class="docs-content">
${bodyHtml}
</article>`;

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}
writeFileSync(outPath, fullHtml, 'utf-8');
console.log(`Generated API docs: ${outPath}`);
