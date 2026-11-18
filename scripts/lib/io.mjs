import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Resolve the base ~/.gemini directory honoring ANTIGRAVITY_GEMINI_DIR.
 */
export function getGeminiDir() {
  return (process.env.ANTIGRAVITY_GEMINI_DIR || '').trim() || join(homedir(), '.gemini');
}

/**
 * Convert a file:// URI or plain path into a normalized local filesystem path.
 */
export function resolveWorkspacePath(uriOrPath) {
  if (!uriOrPath || typeof uriOrPath !== 'string') return '';
  let p = uriOrPath.trim();
  if (p.startsWith('file:')) {
    p = decodeURIComponent(p.replace(/^file:\/\//, ''));
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  }
  return p;
}

/**
 * Read and parse JSON from disk, returning fallback on missing or malformed input.
 */
export function readJsonSafe(filePath, fallback = null) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Atomically write JSON by writing to a sibling temp file then renaming.
 */
export function writeJsonAtomic(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, filePath);
}

/**
 * Atomically write UTF-8 text by writing to a sibling temp file then renaming.
 */
export function writeTextAtomic(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, filePath);
}

/**
 * Normalize an identifier into a URL/filesystem-safe lowercase kebab slug.
 */
export function slugify(value, fallback = 'untitled') {
  const slug = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}
