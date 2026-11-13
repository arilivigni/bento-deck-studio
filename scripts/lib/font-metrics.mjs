/**
 * Minimal, dependency-free reader for the parts of a TrueType/OpenType (sfnt) font that
 * typography calibration needs: vertical metrics, advance widths, cmap, the legacy `kern`
 * table flag and the GPOS `kern` feature (single and pair adjustments, incl. extension lookups).
 */

function tableDirectory(buffer) {
  const tag = buffer.toString('latin1', 0, 4);
  if (!['\0\x01\0\0', 'OTTO', 'true'].includes(tag)) return null;
  const tables = new Map();
  const count = buffer.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    if (record + 16 > buffer.length) return null;
    const offset = buffer.readUInt32BE(record + 8);
    const length = buffer.readUInt32BE(record + 12);
    if (offset + length > buffer.length) continue;
    tables.set(buffer.toString('latin1', record, record + 4), { offset, length });
  }
  return tables;
}

function readCmap(buffer, table) {
  if (!table) return () => 0;
  const base = table.offset;
  const count = buffer.readUInt16BE(base + 2);
  let format4 = null;
  let format12 = null;
  for (let i = 0; i < count; i++) {
    const record = base + 4 + i * 8;
    const platform = buffer.readUInt16BE(record);
    const encoding = buffer.readUInt16BE(record + 2);
    const offset = base + buffer.readUInt32BE(record + 4);
    const format = buffer.readUInt16BE(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12) format12 = offset;
    else if (format === 4) format4 = offset;
  }
  if (format12 !== null) {
    const groups = buffer.readUInt32BE(format12 + 12);
    return (codepoint) => {
      let low = 0;
      let high = groups - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const group = format12 + 16 + mid * 12;
        const start = buffer.readUInt32BE(group);
        const end = buffer.readUInt32BE(group + 4);
        if (codepoint < start) high = mid - 1;
        else if (codepoint > end) low = mid + 1;
        else return buffer.readUInt32BE(group + 8) + codepoint - start;
      }
      return 0;
    };
  }
  if (format4 !== null) {
    const segments = buffer.readUInt16BE(format4 + 6) / 2;
    const ends = format4 + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    return (codepoint) => {
      if (codepoint > 0xffff) return 0;
      for (let i = 0; i < segments; i++) {
        if (codepoint > buffer.readUInt16BE(ends + i * 2)) continue;
        const start = buffer.readUInt16BE(starts + i * 2);
        if (codepoint < start) return 0;
        const delta = buffer.readInt16BE(deltas + i * 2);
        const rangeOffset = buffer.readUInt16BE(ranges + i * 2);
        if (!rangeOffset) return (codepoint + delta) & 0xffff;
        const glyphAt = ranges + i * 2 + rangeOffset + (codepoint - start) * 2;
        const glyph = glyphAt + 2 <= buffer.length ? buffer.readUInt16BE(glyphAt) : 0;
        return glyph ? (glyph + delta) & 0xffff : 0;
      }
      return 0;
    };
  }
  return () => 0;
}

function coverageIndex(buffer, offset, glyph) {
  const format = buffer.readUInt16BE(offset);
  const count = buffer.readUInt16BE(offset + 2);
  let low = 0;
  let high = count - 1;
  if (format === 1) {
    while (low <= high) {
      const mid = (low + high) >> 1;
      const value = buffer.readUInt16BE(offset + 4 + mid * 2);
      if (glyph < value) high = mid - 1;
      else if (glyph > value) low = mid + 1;
      else return mid;
    }
    return -1;
  }
  if (format === 2) {
    while (low <= high) {
      const mid = (low + high) >> 1;
      const range = offset + 4 + mid * 6;
      const start = buffer.readUInt16BE(range);
      const end = buffer.readUInt16BE(range + 2);
      if (glyph < start) high = mid - 1;
      else if (glyph > end) low = mid + 1;
      else return buffer.readUInt16BE(range + 4) + glyph - start;
    }
  }
  return -1;
}

function classOf(buffer, offset, glyph) {
  const format = buffer.readUInt16BE(offset);
  if (format === 1) {
    const start = buffer.readUInt16BE(offset + 2);
    const count = buffer.readUInt16BE(offset + 4);
    return glyph >= start && glyph < start + count ? buffer.readUInt16BE(offset + 6 + (glyph - start) * 2) : 0;
  }
  if (format === 2) {
    let low = 0;
    let high = buffer.readUInt16BE(offset + 2) - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const range = offset + 4 + mid * 6;
      const start = buffer.readUInt16BE(range);
      const end = buffer.readUInt16BE(range + 2);
      if (glyph < start) high = mid - 1;
      else if (glyph > end) low = mid + 1;
      else return buffer.readUInt16BE(range + 4);
    }
  }
  return 0;
}

const bits = (value) => {
  let count = 0;
  for (let v = value; v; v &= v - 1) count += 1;
  return count;
};
const valueSize = (format) => bits(format) * 2;
/** XAdvance of a GPOS value record, in font units. */
const xAdvance = (buffer, offset, format) => (format & 0x4 ? buffer.readInt16BE(offset + bits(format & 0x3) * 2) : 0);
const xPlacement = (buffer, offset, format) => (format & 0x1 ? buffer.readInt16BE(offset) : 0);

function kernFeatureLookups(buffer, gpos) {
  const scriptList = gpos + buffer.readUInt16BE(gpos + 4);
  const featureList = gpos + buffer.readUInt16BE(gpos + 6);
  const featureCount = buffer.readUInt16BE(featureList);
  const features = [];
  for (let i = 0; i < featureCount; i++) {
    const record = featureList + 2 + i * 6;
    features.push({ tag: buffer.toString('latin1', record, record + 4), offset: featureList + buffer.readUInt16BE(record + 4) });
  }
  const lookupsOf = (indices) => {
    const lookups = new Set();
    for (const index of indices) {
      const feature = features[index];
      if (feature?.tag !== 'kern') continue;
      const count = buffer.readUInt16BE(feature.offset + 2);
      for (let i = 0; i < count; i++) lookups.add(buffer.readUInt16BE(feature.offset + 4 + i * 2));
    }
    return lookups;
  };
  const scripts = new Map();
  const scriptCount = buffer.readUInt16BE(scriptList);
  for (let i = 0; i < scriptCount; i++) {
    const record = scriptList + 2 + i * 6;
    scripts.set(buffer.toString('latin1', record, record + 4), scriptList + buffer.readUInt16BE(record + 4));
  }
  for (const tag of ['latn', 'DFLT']) {
    const script = scripts.get(tag);
    if (!script) continue;
    const langSysOffset = buffer.readUInt16BE(script);
    if (!langSysOffset) continue;
    const langSys = script + langSysOffset;
    const count = buffer.readUInt16BE(langSys + 4);
    const indices = Array.from({ length: count }, (_, i) => buffer.readUInt16BE(langSys + 6 + i * 2));
    const lookups = lookupsOf(indices);
    if (lookups.size) return [...lookups].sort((a, b) => a - b);
  }
  return [...lookupsOf(features.map((_, i) => i))].sort((a, b) => a - b);
}

function pairSubtables(buffer, gpos) {
  const lookupList = gpos + buffer.readUInt16BE(gpos + 8);
  const lookupCount = buffer.readUInt16BE(lookupList);
  const lookups = [];
  for (const index of kernFeatureLookups(buffer, gpos)) {
    if (index >= lookupCount) continue;
    const lookup = lookupList + buffer.readUInt16BE(lookupList + 2 + index * 2);
    const type = buffer.readUInt16BE(lookup);
    const count = buffer.readUInt16BE(lookup + 4);
    const subtables = [];
    for (let i = 0; i < count; i++) {
      let offset = lookup + buffer.readUInt16BE(lookup + 6 + i * 2);
      let subtableType = type;
      if (type === 9) {
        subtableType = buffer.readUInt16BE(offset + 2);
        offset += buffer.readUInt32BE(offset + 4);
      }
      if (subtableType === 1 || subtableType === 2) subtables.push({ type: subtableType, offset });
    }
    if (subtables.length) lookups.push(subtables);
  }
  return lookups;
}

/** SinglePos (lookup type 1): a per-glyph advance adjustment, e.g. tracking baked into `kern`. */
function singleAdjustment(buffer, subtable, glyph, read = xAdvance) {
  const coverage = coverageIndex(buffer, subtable + buffer.readUInt16BE(subtable + 2), glyph);
  if (coverage < 0) return null;
  const format = buffer.readUInt16BE(subtable);
  const valueFormat = buffer.readUInt16BE(subtable + 4);
  if (format === 1) return read(buffer, subtable + 6, valueFormat);
  if (format === 2 && coverage < buffer.readUInt16BE(subtable + 6)) return read(buffer, subtable + 8 + coverage * valueSize(valueFormat), valueFormat);
  return null;
}

function pairAdjustment(buffer, subtable, first, second) {
  const format = buffer.readUInt16BE(subtable);
  const coverage = coverageIndex(buffer, subtable + buffer.readUInt16BE(subtable + 2), first);
  if (coverage < 0) return null;
  const format1 = buffer.readUInt16BE(subtable + 4);
  const format2 = buffer.readUInt16BE(subtable + 6);
  const size1 = valueSize(format1);
  const recordSize = size1 + valueSize(format2);
  if (format === 1) {
    if (coverage >= buffer.readUInt16BE(subtable + 8)) return null;
    const pairSet = subtable + buffer.readUInt16BE(subtable + 10 + coverage * 2);
    let low = 0;
    let high = buffer.readUInt16BE(pairSet) - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const record = pairSet + 2 + mid * (2 + recordSize);
      const glyph = buffer.readUInt16BE(record);
      if (second < glyph) high = mid - 1;
      else if (second > glyph) low = mid + 1;
      else return xAdvance(buffer, record + 2, format1) + xAdvance(buffer, record + 2 + size1, format2);
    }
    return null;
  }
  if (format === 2) {
    const class1 = classOf(buffer, subtable + buffer.readUInt16BE(subtable + 8), first);
    const class2 = classOf(buffer, subtable + buffer.readUInt16BE(subtable + 10), second);
    const class1Count = buffer.readUInt16BE(subtable + 12);
    const class2Count = buffer.readUInt16BE(subtable + 14);
    if (class1 >= class1Count || class2 >= class2Count) return null;
    const record = subtable + 16 + (class1 * class2Count + class2) * recordSize;
    return xAdvance(buffer, record, format1) + xAdvance(buffer, record + size1, format2);
  }
  return null;
}

/**
 * Parse an sfnt font. Returns null for anything that is not a plain TrueType/OpenType file
 * (WOFF/WOFF2 are not decoded). Vertical metrics follow Chrome's choice: OS/2 typo metrics
 * when USE_TYPO_METRICS is set, otherwise hhea.
 */
export function readFontMetrics(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const tables = tableDirectory(buffer);
  const head = tables?.get('head');
  const hhea = tables?.get('hhea');
  const hmtx = tables?.get('hmtx');
  if (!head || !hhea || !hmtx) return null;
  const upm = buffer.readUInt16BE(head.offset + 18);
  let ascent = buffer.readInt16BE(hhea.offset + 4);
  let descent = Math.abs(buffer.readInt16BE(hhea.offset + 6));
  const os2 = tables.get('OS/2');
  if (os2 && os2.length >= 74 && buffer.readUInt16BE(os2.offset + 62) & 0x80) {
    ascent = buffer.readInt16BE(os2.offset + 68);
    descent = Math.abs(buffer.readInt16BE(os2.offset + 70));
  }
  const metricCount = buffer.readUInt16BE(hhea.offset + 34);
  const glyphFor = readCmap(buffer, tables.get('cmap'));
  const advance = (glyph) => buffer.readUInt16BE(hmtx.offset + Math.min(glyph, metricCount - 1) * 4);
  const gpos = tables.get('GPOS');
  let kernLookups = [];
  try {
    kernLookups = gpos ? pairSubtables(buffer, gpos.offset) : [];
  } catch {
    kernLookups = [];
  }
  const pairLookups = kernLookups.map((list) => list.filter((entry) => entry.type === 2)).filter((list) => list.length);
  const singleLookups = kernLookups.map((list) => list.filter((entry) => entry.type === 1)).filter((list) => list.length);
  const firstMatch = (lists, read) => lists.reduce((total, list) => {
    for (const entry of list) {
      const value = read(entry.offset);
      if (value !== null) return total + value;
    }
    return total;
  }, 0);
  const pairCache = new Map();
  const singleCache = new Map();
  const kern = (first, second) => {
    const key = first * 65536 + second;
    if (!pairCache.has(key)) pairCache.set(key, firstMatch(pairLookups, (offset) => pairAdjustment(buffer, offset, first, second)));
    return pairCache.get(key);
  };
  const single = (glyph) => {
    if (!singleCache.has(glyph)) singleCache.set(glyph, firstMatch(singleLookups, (offset) => singleAdjustment(buffer, offset, glyph)));
    return singleCache.get(glyph);
  };
  const shift = (glyph) => firstMatch(singleLookups, (offset) => singleAdjustment(buffer, offset, glyph, xPlacement));
  return {
    upm,
    ascent: ascent / upm,
    descent: descent / upm,
    legacyKern: tables.has('kern'),
    gposKern: kernLookups.length > 0,
    /** Unkerned advance width and total GPOS pair kerning for a string, both in em. */
    measure(text) {
      let width = 0;
      let kerning = 0;
      let previous = null;
      let placement = null;
      for (const char of String(text)) {
        const glyph = glyphFor(char.codePointAt(0));
        width += advance(glyph);
        kerning += single(glyph);
        placement ??= shift(glyph);
        if (previous !== null && glyph && previous) kerning += kern(previous, glyph);
        previous = glyph;
      }
      return { width: width / upm, kerning: kerning / upm, placement: (placement ?? 0) / upm };
    }
  };
}
