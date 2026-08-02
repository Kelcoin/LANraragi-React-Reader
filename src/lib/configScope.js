const SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const TABLE = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) | 0);

function rotateLeft(value, bits) {
  return (value << bits) | (value >>> (32 - bits));
}

function wordHex(value) {
  let output = '';
  for (let index = 0; index < 4; index += 1) {
    output += ((value >>> (index * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return output;
}

export function md5(value) {
  const input = new TextEncoder().encode(String(value ?? ''));
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const bitLength = BigInt(input.length) * 8n;
  for (let index = 0; index < 8; index += 1) {
    bytes[paddedLength - 8 + index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Int32Array(16);
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = bytes[start]
        | (bytes[start + 1] << 8)
        | (bytes[start + 2] << 16)
        | (bytes[start + 3] << 24);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let mixed;
      let wordIndex;
      if (index < 16) {
        mixed = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        mixed = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        mixed = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const nextD = c;
      const nextC = b;
      const sum = (a + mixed + TABLE[index] + words[wordIndex]) | 0;
      const nextB = (b + rotateLeft(sum, SHIFT[index])) | 0;
      a = d;
      b = nextB;
      c = nextC;
      d = nextD;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return wordHex(a0) + wordHex(b0) + wordHex(c0) + wordHex(d0);
}

export function normalizeServerUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    url.search = '';
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return text.replace(/\/+$/, '').toLowerCase();
  }
}

export function createServerScopeId(serverUrl) {
  const normalized = normalizeServerUrl(serverUrl);
  return normalized ? md5(normalized) : '';
}

export function createConfigScopeId(serverUrl, apiKey) {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized) return '';
  return md5(`${normalized}\0${String(apiKey || '')}`);
}

function storedValue(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

export function getServerScopeId() {
  return createServerScopeId(storedValue('lrr_server_url'));
}

export function getConfigScopeId() {
  return createConfigScopeId(storedValue('lrr_server_url'), storedValue('lrr_api_key'));
}

export function scopedStorageKey(base) {
  return `${base}:${getConfigScopeId() || 'unconfigured'}`;
}

export function migrateLegacyStorageKey(base) {
  const scoped = scopedStorageKey(base);
  if (scoped.endsWith(':unconfigured')) return scoped;
  try {
    // A one-time migration marker per key: legacy (pre-scope) data may only be
    // claimed by the first scope that touches it, so switching to a fresh
    // config later cannot inherit another config's data.
    const marker = `lrr_legacy_migrated_v1:${base}`;
    if (localStorage.getItem(scoped) === null && !localStorage.getItem(marker)) {
      const legacy = localStorage.getItem(base);
      if (legacy !== null) {
        localStorage.setItem(scoped, legacy);
        localStorage.removeItem(base);
      }
      localStorage.setItem(marker, '1');
    }
  } catch {}
  return scoped;
}

export function scopedCacheKey(key) {
  return `scope:${getConfigScopeId() || 'unconfigured'}:${key}`;
}
