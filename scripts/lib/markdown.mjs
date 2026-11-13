// A small, safe Markdown subset for the project website. Raw HTML is always
// escaped; only http(s), mailto, relative, and fragment links are emitted.

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function parseFrontmatter(source) {
  const text = source.replace(/\r\n?/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, body: text };
  const data = {};
  for (const line of match[1].split('\n')) {
    const pair = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (pair) data[pair[1]] = pair[2].replace(/^(["'])(.*)\1$/, '$2').trim();
  }
  return { data, body: text.slice(match[0].length) };
}

export function safeUrl(url) {
  const value = String(url).trim();
  if (/^(https?:|mailto:)/i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return null;
  return value;
}

export function renderInline(text, options = {}) {
  const rewrite = options.rewriteUrl ?? ((url) => url);
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let out = String(text).replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, code) => keep(`<code>${escapeHtml(code.trim())}</code>`));
  out = out.replace(/\\([\\`*_[\]()#+\-.!|<>])/g, (_, ch) => keep(escapeHtml(ch)));
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, alt, src, title) => {
    const url = safeUrl(src);
    if (!url) return keep(escapeHtml(alt));
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return keep(`<img src="${escapeHtml(rewrite(url))}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy">`);
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const url = safeUrl(href);
    if (!url) return label;
    const external = /^https?:/i.test(url);
    const attrs = external ? ' rel="noopener"' : '';
    return keep(`<a href="${escapeHtml(rewrite(url))}"${attrs}>`) + label + keep('</a>');
  });
  const refs = options.refs ?? {};
  out = out.replace(/\[([^\]]+)\](?:\[([^\]]*)\])?/g, (match, label, ref) => {
    const url = safeUrl(refs[(ref || label).toLowerCase()] ?? '');
    if (!url) return match;
    const attrs = /^https?:/i.test(url) ? ' rel="noopener"' : '';
    return keep(`<a href="${escapeHtml(rewrite(url))}"${attrs}>`) + label + keep('</a>');
  });
  out = out.replace(/<(https?:\/\/[^\s>]+)>/g, (_, url) => keep(`<a href="${escapeHtml(url)}" rel="noopener">${escapeHtml(url)}</a>`));
  out = escapeHtml(out);
  out = out
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)]);
}

function splitRow(line) {
  const cells = [];
  let cell = '';
  let code = false;
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') { cell += '|'; i++; continue; }
    if (ch === '`') code = !code;
    if (ch === '|' && !code) { cells.push(cell.trim()); cell = ''; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function renderList(lines, start, options) {
  const first = lines[start].match(LIST_ITEM);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const match = lines[i].match(LIST_ITEM);
    if (match && match[1].length === indent && /\d/.test(match[2]) === ordered) {
      items.push({ text: [match[3]], children: [] });
      i++;
      continue;
    }
    if (match && match[1].length > indent && items.length) {
      const nested = renderList(lines, i, options);
      items.at(-1).children.push(nested.html);
      i = nested.next;
      continue;
    }
    if (!match && items.length && lines[i].trim() && /^\s+/.test(lines[i])) {
      items.at(-1).text.push(lines[i].trim());
      i++;
      continue;
    }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const startNumber = ordered ? Number.parseInt(first[2], 10) : 1;
  const startAttr = ordered && startNumber !== 1 ? ` start="${startNumber}"` : '';
  const tasks = items.some((item) => /^\[[ xX]\]\s/.test(item.text[0]));
  const itemHtml = (item) => {
    const task = item.text[0].match(/^\[([ xX])\]\s+/);
    const text = item.text.join(' ').slice(task ? task[0].length : 0);
    const box = task ? `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'} aria-hidden="true"> ` : '';
    return `<li${task ? ' class="task"' : ''}>${box}${renderInline(text, options)}${item.children.join('')}</li>`;
  };
  const html = `<${tag}${startAttr}${tasks ? ' class="tasks"' : ''}>${items.map(itemHtml).join('')}</${tag}>`;
  return { html, next: i };
}

export function renderMarkdown(source, options = {}) {
  const refs = { ...(options.refs ?? {}) };
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n').filter((line) => {
    const def = line.match(/^\s{0,3}\[([^\]]+)\]:\s+(\S+)\s*$/);
    if (def) refs[def[1].toLowerCase()] = def[2];
    return !def;
  });
  options = { ...options, refs };
  const headings = [];
  const used = new Map();
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push(`<p>${renderInline(paragraph.join(' '), options)}</p>`);
    paragraph = [];
  };
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const fence = line.match(/^(\s*)(```|~~~)\s*([\w+-]*)\s*$/);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[2])) body.push(lines[i++]);
      i++;
      const lang = fence[3] ? ` class="language-${escapeHtml(fence[3])}" data-lang="${escapeHtml(fence[3])}"` : '';
      blocks.push(`<pre><code${lang}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*<!--[\s\S]*-->\s*$/.test(line)) { flush(); i++; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      const html = renderInline(heading[2], options);
      const base = slugify(html) || 'section';
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      const id = count ? `${base}-${count}` : base;
      headings.push({ level, id, text: html.replace(/<[^>]*>/g, '') });
      blocks.push(`<h${level} id="${id}">${html}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); blocks.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(`<blockquote>${renderMarkdown(quote.join('\n'), options).html}</blockquote>`);
      continue;
    }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')) {
      flush();
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map((cell) => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : ''));
      const cellAttr = (index) => (align[index] ? ` class="align-${align[index]}"` : '');
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      blocks.push(`<div class="table-wrap"><table><thead><tr>${header.map((cell, index) => `<th${cellAttr(index)}>${renderInline(cell, options)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, index) => `<td${cellAttr(index)}>${renderInline(row[index] ?? '', options)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (LIST_ITEM.test(line) && !paragraph.length) {
      const list = renderList(lines, i, options);
      blocks.push(list.html);
      i = list.next;
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    paragraph.push(line.trim());
    i++;
  }
  flush();
  return { html: blocks.join('\n'), headings };
}
