export function decodeXml(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity) => {
    if (entity[0] !== '#') {
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()] ?? whole;
    }
    const code = entity[1].toLowerCase() === 'x'
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : whole;
  });
}

export function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1]] = decodeXml(match[2] ?? match[3] ?? '');
  }
  return result;
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;

/** Minimal namespace-unaware XML DOM: { name, attrs, children, text }. */
export function parseXml(text) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  for (const match of String(text).matchAll(TOKEN)) {
    const [, cdata, closing, opening, attrText, selfClosing, chars] = match;
    const top = stack[stack.length - 1];
    if (opening) {
      const node = { name: opening, attrs: attrText ? attributes(attrText) : {}, children: [], text: '' };
      top.children.push(node);
      if (!selfClosing) stack.push(node);
    } else if (closing) {
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth].name === closing) {
          stack.length = depth;
          break;
        }
      }
    } else if (cdata !== undefined) {
      top.text += cdata;
    } else if (chars !== undefined && top !== root) {
      top.text += decodeXml(chars);
    }
  }
  return root.children[0] ?? root;
}

export function kid(node, name) {
  return node?.children.find((child) => child.name === name);
}

export function kids(node, name) {
  return node ? (name ? node.children.filter((child) => child.name === name) : node.children) : [];
}

export function pathKid(node, path) {
  return path.split('/').reduce((current, name) => kid(current, name), node);
}

export function descendants(node, name, out = []) {
  for (const child of node?.children ?? []) {
    if (child.name === name) out.push(child);
    descendants(child, name, out);
  }
  return out;
}

export function textContent(node) {
  return (node?.text ?? '') + (node?.children ?? []).map(textContent).join('');
}

export function firstTag(xml, qualifiedName) {
  const escaped = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'i'));
  return match?.[1] ?? '';
}
