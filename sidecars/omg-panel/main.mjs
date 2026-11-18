/**
 * Sidecar backend for the OMG Orchestrator Aux Pane panel.
 * Serves the panel UI, context + input/output/cached token usage API,
 * milestone/todo sync API, and live model configuration API.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';
import { getGeminiDir } from '../../scripts/lib/io.mjs';
import { createPanelController, writeCatalogCache } from './lib/server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..', '..');
const SCRIPT = join(HERE, 'context_report.py');
const GEMINI_DIR = getGeminiDir();
const CONVERSATIONS = join(GEMINI_DIR, 'antigravity', 'conversations');
const BRAIN_DIR = join(GEMINI_DIR, 'antigravity', 'brain');
const DATA_DIR = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || join(HERE, '.data');
const CATALOG_PATH = join(DATA_DIR, 'model-catalog.json');
const CATALOG_TTL_MS = 10 * 60 * 1000;

const PYTHON_CANDIDATES = process.platform === 'win32'
  ? [['python', []], ['py', ['-3']], ['python3', []]]
  : [['python3', []], ['python', []]];
let python = null;

function run(cmd, args, timeout = 20000) {
  return new Promise((resolvePromise, reject) => {
    execFile(cmd, args, {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolvePromise(stdout)));
  });
}

async function findPython() {
  if (python) return python;
  for (const [cmd, pre] of PYTHON_CANDIDATES) {
    try {
      const out = await run(cmd, [...pre, '--version'], 5000);
      if (/^Python 3\./.test(out.trim())) {
        python = { cmd, pre };
        return python;
      }
    } catch {
      // Try next Python binary candidate.
    }
  }
  throw new Error('Python 3 not found. Install Python 3 and restart Antigravity.');
}

let catalogFetchedAt = 0;

function lsRequest(method, body) {
  const addr = (process.env.ANTIGRAVITY_LS_ADDRESS || '').trim();
  const csrf = (process.env.ANTIGRAVITY_CSRF_TOKEN || '').trim();
  if (!addr || !csrf) return Promise.reject(new Error('no language server address'));
  const base = new URL(addr.startsWith('http') ? addr : `http://${addr}`);
  const data = JSON.stringify(body);
  const transport = base.protocol === 'https:' ? https : http;
  return new Promise((resolvePromise, reject) => {
    const req = transport.request({
      hostname: base.hostname,
      port: base.port,
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': csrf,
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 5000,
      rejectUnauthorized: false,
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${method}: HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolvePromise(JSON.parse(text));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${method}: timeout`)));
    req.on('error', reject);
    req.end(data);
  });
}

async function refreshCatalog() {
  if (Date.now() - catalogFetchedAt < CATALOG_TTL_MS && existsSync(CATALOG_PATH)) return;
  catalogFetchedAt = Date.now();
  try {
    const resp = await lsRequest('GetAvailableModels', { metadata: { ideName: 'antigravity', extensionName: 'antigravity' } });
    const rawModels = resp?.response?.models || resp?.models || resp?.clientModelConfigs || {};
    const entries = Array.isArray(rawModels)
      ? rawModels.map((m) => [m?.modelOrAlias?.model || m?.model || m?.id || m?.displayName, m])
      : Object.entries(rawModels);
    const catalog = {};
    for (const [id, m] of entries) {
      if (!id) continue;
      const maxTokens = Number(m?.maxTokens) || 0;
      if (maxTokens > 0 || m?.displayName) {
        catalog[id] = { maxTokens, displayName: m?.displayName || id };
      }
    }
    writeCatalogCache(CATALOG_PATH, DATA_DIR, catalog);
  } catch (err) {
    console.error('[omg-panel] model catalog unavailable, using fallback limits:', err.message);
  }
}

async function runContextReport({ db, workspace, catalogPath }) {
  const { cmd, pre } = await findPython();
  const args = [...pre, SCRIPT, '--db', db, '--json'];
  if (existsSync(catalogPath)) args.push('--model-catalog', catalogPath);
  if (workspace) args.push('--workspace', workspace);
  const out = await run(cmd, args);
  return JSON.parse(out);
}

async function discoverChildren({ db }) {
  try {
    const { cmd, pre } = await findPython();
    const out = await run(cmd, [...pre, SCRIPT, '--db', db, '--discover-children', '--brain-dir', BRAIN_DIR]);
    return JSON.parse(out)?.children || [];
  } catch {
    return [];
  }
}

const controller = createPanelController({
  conversationsDir: CONVERSATIONS,
  catalogPath: CATALOG_PATH,
  runContextReport,
  discoverChildren,
  refreshCatalog,
});

const app = new SidecarApp();

app.page('/', () => new Response(readFileSync(join(HERE, 'index.html'), 'utf8'), { contentType: 'text/html' }));

app.page('/logos/omg.png', () => {
  const logoPath = join(PLUGIN_ROOT, 'logos', 'omg.png');
  return new Response(readFileSync(logoPath), { contentType: 'image/png' });
});

function wrap(fn) {
  return async (data) => {
    try {
      return await fn(data);
    } catch (err) {
      return { error: 'failed', message: err.message };
    }
  };
}

app.api('/api/report', wrap((d) => controller.getReport(d)), 'GET');
app.api('/api/agents', wrap((d) => controller.getAgents(d)), 'GET');
app.api('/api/agents/clear', wrap((d) => controller.clearAgents(d)), 'POST');
app.api('/api/todos', wrap((d) => controller.getTodos(d)), 'GET');
app.api('/api/todos/toggle', wrap((d) => controller.toggleTodo(d)), 'POST');
app.api('/api/todos/topic', wrap((d) => controller.selectTopic(d)), 'POST');
app.api('/api/models', wrap(() => controller.getModels()), 'GET');
app.api('/api/config', wrap((d) => controller.getConfig(d)), 'GET');
app.api('/api/config', wrap((d) => controller.saveConfigHandler(d)), 'POST');
app.api('/api/config/reset', wrap((d) => controller.resetConfigHandler(d)), 'POST');

app.run();
refreshCatalog();
