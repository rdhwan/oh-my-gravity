import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  FALLBACK_MODELS,
  ROLES,
  deriveTier,
  loadConfig,
  resetConfig,
  saveConfig,
} from '../../../scripts/lib/config.mjs';
import { resolveWorkspacePath, writeJsonAtomic } from '../../../scripts/lib/io.mjs';
import { clearAgentsActivity, loadTodoState, updateTodoItem } from '../../../scripts/lib/plans.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fileStamp(filePath) {
  try {
    const s = statSync(filePath);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return '-';
  }
}

/**
 * Normalize request payload regardless of whether SidecarApp passes body flat or nested.
 */
export function normalizePayload(data) {
  if (!data || typeof data !== 'object') return {};
  if (typeof data.body === 'string') {
    try {
      return { ...data, ...JSON.parse(data.body) };
    } catch {
      return data;
    }
  }
  if (data.body && typeof data.body === 'object') {
    return { ...data, ...data.body };
  }
  return data;
}

/**
 * Build the testable OMG Sidecar API controller.
 */
export function createPanelController({
  conversationsDir,
  catalogPath,
  runContextReport,
  discoverChildren = async () => [],
  refreshCatalog,
}) {
  const reportCache = new Map();

  function readModelsCatalog() {
    try {
      if (!existsSync(catalogPath)) return [];
      const raw = JSON.parse(readFileSync(catalogPath, 'utf8'));
      const list = Object.entries(raw).map(([id, m]) => ({
        id,
        displayName: m?.displayName || id,
        maxTokens: Number(m?.maxTokens) || 0,
        tier: deriveTier(id),
      }));
      return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    } catch {
      return [];
    }
  }

  return {
    async getReport(rawQuery) {
      const data = normalizePayload(rawQuery);
      const conversationId = String(data.conversationId || '').trim();
      if (!UUID.test(conversationId)) return { error: 'no-conversation' };

      const db = join(conversationsDir, `${conversationId}.db`);
      if (!existsSync(db)) return { error: 'no-database' };

      await refreshCatalog();
      const workspace = resolveWorkspacePath(data.workspace || '');
      const key = [fileStamp(db), fileStamp(`${db}-wal`), workspace, fileStamp(catalogPath)].join('|');
      const cached = reportCache.get(conversationId);
      if (cached && cached.key === key) return cached.report;

      const parsed = await runContextReport({ db, workspace, catalogPath });
      const result = { ...parsed, updatedAt: new Date().toISOString() };
      reportCache.set(conversationId, { key, report: result });
      return result;
    },

    async getAgents(rawQuery) {
      const data = normalizePayload(rawQuery);
      const conversationId = String(data.conversationId || '').trim();
      const workspace = resolveWorkspacePath(data.workspace || '');
      if (!UUID.test(conversationId)) return { error: 'no-conversation', agents: [], totals: null };

      const db = join(conversationsDir, `${conversationId}.db`);
      if (!existsSync(db)) return { error: 'no-database', agents: [], totals: null };

      const mainReport = await this.getReport({ conversationId, workspace });
      const childrenMeta = await discoverChildren({ db, workspace, catalogPath });

      const agents = [];
      if (!mainReport.error) {
        agents.push({
          conversationId,
          label: 'Orchestrator (Main)',
          role: 'orchestrator',
          isMain: true,
          model: mainReport.model,
          modelId: mainReport.model_id,
          usedTokens: mainReport.used_tokens,
          limitTokens: mainReport.limit_tokens,
          usedPct: mainReport.used_pct,
          tokenUsage: mainReport.token_usage,
        });
      }

      for (const child of childrenMeta || []) {
        const cid = String(child?.conversation_id || '').trim();
        if (!UUID.test(cid)) continue;
        const childReport = await this.getReport({ conversationId: cid, workspace });
        if (childReport.error) continue;
        agents.push({
          conversationId: cid,
          label: child.label || child.role || `Agent ${cid.slice(0, 8)}`,
          role: child.role || 'subagent',
          source: child.source || 'subagent',
          isMain: false,
          model: childReport.model,
          modelId: childReport.model_id,
          usedTokens: childReport.used_tokens,
          limitTokens: childReport.limit_tokens,
          usedPct: childReport.used_pct,
          tokenUsage: childReport.token_usage,
        });
      }

      let totalIn = 0;
      let totalOut = 0;
      let totalCached = 0;
      let totalThink = 0;
      for (const a of agents) {
        const s = a.tokenUsage?.session || {};
        totalIn += Number(s.input_tokens) || 0;
        totalOut += Number(s.output_tokens) || 0;
        totalCached += Number(s.cached_tokens) || 0;
        totalThink += Number(s.thinking_tokens) || 0;
      }
      const totalPrompt = totalIn + totalCached;
      const totals = {
        agentCount: agents.length,
        subagentCount: Math.max(0, agents.length - 1),
        input_tokens: totalIn,
        output_tokens: totalOut,
        cached_tokens: totalCached,
        thinking_tokens: totalThink,
        cache_hit_pct: totalPrompt > 0 ? Math.round((totalCached / totalPrompt) * 1000) / 10 : 0,
      };

      const todoState = workspace ? loadTodoState(workspace) : { agents: {} };
      return {
        parentId: conversationId,
        agents,
        totals,
        activeRoles: todoState.agents || {},
      };
    },

    async getTodos(rawQuery) {
      const data = normalizePayload(rawQuery);
      const workspace = resolveWorkspacePath(data.workspace || '');
      if (!workspace) {
        return { error: 'no-workspace', activeTopic: '', topics: {}, agents: {} };
      }
      return loadTodoState(workspace);
    },

    async clearAgents(rawBody) {
      const data = normalizePayload(rawBody);
      const workspace = resolveWorkspacePath(data.workspace || '');
      if (!workspace) return { error: 'no-workspace' };
      const state = clearAgentsActivity(workspace);
      return { ok: true, state };
    },

    async toggleTodo(rawBody) {
      const data = normalizePayload(rawBody);
      const workspace = resolveWorkspacePath(data.workspace || '');
      if (!workspace) return { error: 'no-workspace' };
      const nextStatus = data.status === 'done' ? 'done' : data.status === 'in_progress' ? 'in_progress' : 'pending';
      const state = updateTodoItem(workspace, data.topic, data.milestoneId, data.todoId, nextStatus, data.note);
      return { ok: true, state };
    },

    async selectTopic(rawBody) {
      const data = normalizePayload(rawBody);
      const workspace = resolveWorkspacePath(data.workspace || '');
      if (!workspace) return { error: 'no-workspace' };
      const state = loadTodoState(workspace);
      if (data.topic && state.topics[data.topic]) {
        state.activeTopic = data.topic;
        state.updatedAt = new Date().toISOString();
        writeJsonAtomic(join(workspace, '.omg', 'state', 'todos.json'), state);
      }
      return { ok: true, state };
    },

    async getModels() {
      await refreshCatalog();
      const live = readModelsCatalog();
      const byId = new Map();
      const byName = new Map();

      // Seed with verified swarm model slugs so every role always sees Hydrogen/Argon/Flash/Claude options.
      for (const m of FALLBACK_MODELS) {
        const entry = { ...m, tier: deriveTier(m.id) };
        byId.set(entry.id, entry);
        byName.set(entry.displayName.toLowerCase(), entry);
      }

      // Merge any additional models discovered from the live Language Server catalog.
      for (const m of live) {
        const nameKey = String(m.displayName || '').toLowerCase();
        if (byId.has(m.id)) {
          const existing = byId.get(m.id);
          if (m.maxTokens > 0) existing.maxTokens = m.maxTokens;
          if (m.displayName) existing.displayName = m.displayName;
        } else if (!nameKey || !byName.has(nameKey)) {
          byId.set(m.id, m);
          if (nameKey) byName.set(nameKey, m);
        }
      }

      const models = Array.from(byId.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
      return { source: live.length ? 'live' : 'fallback', models };
    },

    async getConfig(rawQuery) {
      const data = normalizePayload(rawQuery);
      const workspace = resolveWorkspacePath(data.workspace || '');
      return {
        roles: ROLES,
        defaults: DEFAULT_CONFIG,
        ...loadConfig(workspace),
      };
    },

    async saveConfigHandler(rawBody) {
      const data = normalizePayload(rawBody);
      const scope = data.scope === 'workspace' ? 'workspace' : 'global';
      const workspace = resolveWorkspacePath(data.workspace || '');
      const saved = saveConfig(data.patch || data.config || {}, scope, workspace);
      return {
        ok: true,
        savedPath: saved.path,
        roles: ROLES,
        defaults: DEFAULT_CONFIG,
        ...loadConfig(workspace),
      };
    },

    async resetConfigHandler(rawBody) {
      const data = normalizePayload(rawBody);
      const scope = data.scope === 'workspace' ? 'workspace' : 'global';
      const workspace = resolveWorkspacePath(data.workspace || '');
      const saved = resetConfig(scope, workspace);
      return {
        ok: true,
        savedPath: saved.path,
        roles: ROLES,
        defaults: DEFAULT_CONFIG,
        ...loadConfig(workspace),
      };
    },
  };
}

/**
 * Helper to persist model catalog JSON safely.
 */
export function writeCatalogCache(catalogPath, dataDir, catalog) {
  if (!Object.keys(catalog || {}).length) return;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(catalogPath, JSON.stringify(catalog));
}
