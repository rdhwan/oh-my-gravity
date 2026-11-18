import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getGeminiDir, readJsonSafe, resolveWorkspacePath, writeJsonAtomic } from './io.mjs';

export const ROLES = ['orchestrator', 'plan', 'explore', 'documents', 'build', 'oracle'];
export const BACKENDS = ['swarm', 'subagent'];
export const TIERS = ['inherit', 'flash_lite', 'flash', 'pro'];

/**
 * Fallback model catalog used when the Antigravity Language Server is unreachable.
 */
export const FALLBACK_MODELS = [
  { id: 'gemini-4-argon-high', displayName: 'Gemini 4 Argon (High)', maxTokens: 1048576 },
  { id: 'gemini-4-argon-medium', displayName: 'Gemini 4 Argon (Medium)', maxTokens: 1048576 },
  { id: 'gemini-4-argon-low', displayName: 'Gemini 4 Argon (Low)', maxTokens: 1048576 },
  { id: 'gemini-4-hydrogen-xhigh', displayName: 'Gemini 4 Hydrogen (XHigh)', maxTokens: 1048576 },
  { id: 'gemini-4-hydrogen-high', displayName: 'Gemini 4 Hydrogen (High)', maxTokens: 1048576 },
  { id: 'gemini-4-hydrogen-medium', displayName: 'Gemini 4 Hydrogen (Medium)', maxTokens: 1048576 },
  { id: 'gemini-4-hydrogen-low', displayName: 'Gemini 4 Hydrogen (Low)', maxTokens: 1048576 },
  { id: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)', maxTokens: 1048576 },
  { id: 'gemini-3.8-flash-medium', displayName: 'Gemini 3.8 Flash (Medium)', maxTokens: 1048576 },
  { id: 'gemini-3.8-flash-low', displayName: 'Gemini 3.8 Flash (Low)', maxTokens: 1048576 },
  { id: 'claude-opus-5-5-high', displayName: 'Claude Opus 5.5 (High)', maxTokens: 1000000 },
  { id: 'claude-opus-5-5-medium', displayName: 'Claude Opus 5.5 (Medium)', maxTokens: 1000000 },
  { id: 'claude-opus-5-5-low', displayName: 'Claude Opus 5.5 (Low)', maxTokens: 1000000 },
  { id: 'claude-sonnet-5-5-high', displayName: 'Claude Sonnet 5.5 (High)', maxTokens: 1000000 },
  { id: 'claude-sonnet-5-5-medium', displayName: 'Claude Sonnet 5.5 (Medium)', maxTokens: 1000000 },
  { id: 'claude-sonnet-5-5-low', displayName: 'Claude Sonnet 5.5 (Low)', maxTokens: 1000000 },
  { id: 'gemini-pro-orchestrator-g1-pro', displayName: 'Orchestrator (Argon)', maxTokens: 1048576 },
  { id: 'gpt-oss-120b-medium', displayName: 'GPT-OSS 120B (Medium)', maxTokens: 131072 },
];

export const DEFAULT_CONFIG = {
  version: 1,
  backend: 'swarm',
  confirmBetweenMilestones: true,
  agents: {
    orchestrator: { model: 'gemini-4-hydrogen-high', tier: 'pro', backend: 'inherit' },
    plan: { model: 'gemini-4-hydrogen-high', tier: 'pro', backend: 'inherit' },
    explore: { model: 'gemini-3.8-flash-low', tier: 'flash_lite', backend: 'inherit' },
    documents: { model: 'gemini-3.8-flash-medium', tier: 'flash', backend: 'inherit' },
    build: { model: 'gemini-4-hydrogen-medium', tier: 'flash', backend: 'inherit' },
    oracle: { model: 'gemini-4-argon-high', tier: 'pro', backend: 'inherit' },
  },
};

const SUBAGENT_TYPE_TO_ROLE = {
  'omg-planner': 'plan',
  'omg-explorer': 'explore',
  'omg-documenter': 'documents',
  'omg-builder': 'build',
  'omg-oracle': 'oracle',
  plan: 'plan',
  explore: 'explore',
  explorer: 'explore',
  documents: 'documents',
  documenter: 'documents',
  build: 'build',
  builder: 'build',
  oracle: 'oracle',
};

/**
 * Map a model ID to the closest invoke_subagent Model tier enum.
 */
export function deriveTier(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (!id) return 'inherit';
  if (id.includes('flash') && id.endsWith('-low')) return 'flash_lite';
  if (id.includes('flash') || id.includes('gpt-oss')) return 'flash';
  if (id.includes('hydrogen') && (id.endsWith('-low') || id.endsWith('-medium'))) return 'flash';
  if (id.includes('sonnet') && id.endsWith('-low')) return 'flash';
  return 'pro';
}

/**
 * Resolve the global OMG configuration file path.
 */
export function getGlobalConfigPath() {
  const override = (process.env.OMG_GLOBAL_CONFIG || '').trim();
  if (override) return override;
  return join(getGeminiDir(), 'config', 'omg', 'config.json');
}

/**
 * Resolve the workspace-level OMG configuration file path.
 */
export function getWorkspaceConfigPath(workspaceUriOrPath) {
  const root = resolveWorkspacePath(workspaceUriOrPath);
  if (!root) return '';
  return join(root, '.omg', 'config.json');
}

function normalizeAgentEntry(entry, defaults) {
  const raw = entry && typeof entry === 'object' ? entry : {};
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : defaults.model;
  const tier = TIERS.includes(raw.tier) ? raw.tier : deriveTier(model);
  const backend = raw.backend === 'inherit' || BACKENDS.includes(raw.backend) ? raw.backend : defaults.backend;
  return { model, tier, backend };
}

/**
 * Normalize and merge partial config objects against DEFAULT_CONFIG.
 */
export function mergeConfigs(...layers) {
  const result = {
    version: 1,
    backend: DEFAULT_CONFIG.backend,
    confirmBetweenMilestones: DEFAULT_CONFIG.confirmBetweenMilestones,
    agents: {},
  };

  for (const role of ROLES) {
    result.agents[role] = { ...DEFAULT_CONFIG.agents[role] };
  }

  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    if (BACKENDS.includes(layer.backend)) result.backend = layer.backend;
    if (typeof layer.confirmBetweenMilestones === 'boolean') {
      result.confirmBetweenMilestones = layer.confirmBetweenMilestones;
    }
    if (layer.agents && typeof layer.agents === 'object') {
      for (const role of ROLES) {
        if (layer.agents[role]) {
          result.agents[role] = normalizeAgentEntry(layer.agents[role], result.agents[role]);
        }
      }
    }
  }
  return result;
}

/**
 * Load effective configuration (DEFAULT_CONFIG < global < workspace).
 */
export function loadConfig(workspaceUriOrPath = '') {
  const globalPath = getGlobalConfigPath();
  const wsPath = getWorkspaceConfigPath(workspaceUriOrPath);
  const globalRaw = readJsonSafe(globalPath, null);
  const wsRaw = wsPath ? readJsonSafe(wsPath, null) : null;
  const effective = mergeConfigs(globalRaw, wsRaw);
  return {
    effective,
    globalPath,
    workspacePath: wsPath,
    hasGlobal: Boolean(globalRaw),
    hasWorkspace: Boolean(wsRaw),
    globalRaw: globalRaw || {},
    workspaceRaw: wsRaw || {},
  };
}

function mergeRawPatch(existing, patch) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  const src = patch && typeof patch === 'object' ? patch : {};
  const next = { ...base, version: 1 };

  if (BACKENDS.includes(src.backend)) next.backend = src.backend;
  if (typeof src.confirmBetweenMilestones === 'boolean') {
    next.confirmBetweenMilestones = src.confirmBetweenMilestones;
  }

  if (src.agents && typeof src.agents === 'object') {
    const prevAgents = base.agents && typeof base.agents === 'object' ? base.agents : {};
    const nextAgents = { ...prevAgents };
    for (const role of ROLES) {
      if (!src.agents[role] || typeof src.agents[role] !== 'object') continue;
      const prevRole = prevAgents[role] && typeof prevAgents[role] === 'object' ? prevAgents[role] : {};
      const patchRole = src.agents[role];
      const mergedRole = { ...prevRole };
      if (typeof patchRole.model === 'string' && patchRole.model.trim()) {
        mergedRole.model = patchRole.model.trim();
        mergedRole.tier = TIERS.includes(patchRole.tier) ? patchRole.tier : deriveTier(mergedRole.model);
      } else if (TIERS.includes(patchRole.tier)) {
        mergedRole.tier = patchRole.tier;
      }
      if (patchRole.backend === 'inherit' || BACKENDS.includes(patchRole.backend)) {
        mergedRole.backend = patchRole.backend;
      }
      nextAgents[role] = mergedRole;
    }
    next.agents = nextAgents;
  }
  return next;
}

/**
 * Save configuration to either 'global' or 'workspace' scope atomically.
 * Preserves sparse overrides in workspace scope so untouched roles still inherit global settings.
 */
export function saveConfig(patch, scope = 'global', workspaceUriOrPath = '') {
  const targetPath = scope === 'workspace' ? getWorkspaceConfigPath(workspaceUriOrPath) : getGlobalConfigPath();
  if (!targetPath) {
    throw new Error('Cannot save workspace config without an active workspace path.');
  }
  const existing = existsSync(targetPath) ? readJsonSafe(targetPath, {}) : {};
  const mergedRaw = mergeRawPatch(existing, patch);
  const toWrite = scope === 'workspace' ? mergedRaw : mergeConfigs(mergedRaw);
  writeJsonAtomic(targetPath, toWrite);
  return { path: targetPath, config: toWrite };
}

/**
 * Reset a scope config back to defaults (workspace clears overrides; global restores DEFAULT_CONFIG).
 */
export function resetConfig(scope = 'global', workspaceUriOrPath = '') {
  const targetPath = scope === 'workspace' ? getWorkspaceConfigPath(workspaceUriOrPath) : getGlobalConfigPath();
  if (!targetPath) {
    throw new Error('Cannot reset workspace config without an active workspace path.');
  }
  const toWrite = scope === 'workspace' ? { version: 1 } : mergeConfigs(DEFAULT_CONFIG);
  writeJsonAtomic(targetPath, toWrite);
  return { path: targetPath, config: toWrite };
}

/**
 * Infer an OMG role from a swarm worker name (e.g. 'explore-auth', 'build-m1') or subagent TypeName.
 */
export function resolveRoleFromTarget(nameOrType) {
  const raw = String(nameOrType || '').toLowerCase().trim();
  if (!raw) return null;
  if (SUBAGENT_TYPE_TO_ROLE[raw]) return SUBAGENT_TYPE_TO_ROLE[raw];
  const stripped = raw.startsWith('omg-') ? raw.slice(4) : raw;
  for (const role of ROLES) {
    if (role === 'orchestrator') continue;
    if (stripped === role || stripped.startsWith(`${role}-`)) return role;
  }
  if (stripped.startsWith('explorer')) return 'explore';
  if (stripped.startsWith('planner')) return 'plan';
  if (stripped.startsWith('doc')) return 'documents';
  if (stripped.startsWith('builder') || stripped.startsWith('fixer')) return 'build';
  return null;
}

/**
 * Return the effective execution backend ('swarm' or 'subagent') for a given role.
 */
export function resolveRoleBackend(effectiveConfig, role) {
  const agent = effectiveConfig?.agents?.[role];
  if (agent && BACKENDS.includes(agent.backend)) return agent.backend;
  return BACKENDS.includes(effectiveConfig?.backend) ? effectiveConfig.backend : 'swarm';
}
