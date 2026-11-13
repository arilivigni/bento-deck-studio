import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 10000;
const MAX_ENTRY_SIZE = 64 * 1024 * 1024;
const MAX_TOTAL_SIZE = 256 * 1024 * 1024;

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndRecord(buffer) {
  const start = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD) return offset;
  }
  throw new Error('Invalid ZIP: end-of-directory record not found.');
}

export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('ZIP input must be a Buffer.');
  const eocd = findEndRecord(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    throw new Error('ZIP64 files are not supported.');
  }
  if (count > MAX_ENTRIES || directoryOffset + directorySize > eocd) {
    throw new Error('Invalid or oversized ZIP directory.');
  }

  const files = new Map();
  let totalSize = 0;
  let cursor = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL) {
      throw new Error('Invalid ZIP central directory.');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = buffer.toString('utf8', nameStart, nameStart + nameLength);
    cursor = nameStart + nameLength + extraLength + commentLength;

    if (!name || name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error(`Unsafe ZIP entry path: ${name}`);
    }
    if (files.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    if (flags & 1) throw new Error(`Encrypted ZIP entry is not supported: ${name}`);
    if (size > MAX_ENTRY_SIZE || (totalSize += size) > MAX_TOTAL_SIZE) {
      throw new Error('ZIP exceeds the uncompressed size safety limit.');
    }
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method ${method}: ${name}`);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL) {
      throw new Error(`Invalid local ZIP header: ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error(`Truncated ZIP entry: ${name}`);
    const compressed = buffer.subarray(dataStart, dataEnd);
    const data = method === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_SIZE });
    if (data.length !== size || crc32(data) !== expectedCrc) {
      throw new Error(`ZIP integrity check failed: ${name}`);
    }
    files.set(name, data);
  }
  return files;
}
