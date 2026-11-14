/**
 * Export the reviewed frontend knowledge chunks to the backend seed JSON.
 *
 * Run from the repository root:
 *   node scripts/export_kb_seed.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHUNKS } from '../code/frontend/src/kb/chunks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'code', 'backend', 'app', 'rag', 'kb_seed.json');

const rows = CHUNKS.map((chunk) => ({
  id: chunk.id,
  category: chunk.category,
  dims: chunk.dims,
  title: chunk.title,
  text: chunk.text,
  source: chunk.source,
  version: chunk.version,
  risk: chunk.risk,
  review_status: chunk.review?.status || 'draft',
  reviewed_by: chunk.review?.by || null,
  reviewed_at: chunk.review?.date || null,
  tags: chunk.tags || [],
  param: chunk.param ?? null,
}));

fs.writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
