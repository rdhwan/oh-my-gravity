#!/usr/bin/env node
/**
 * Antigravity lifecycle hook handler for oh-my-gravity (OMG).
 * - PreInvocation: injects compact OMG routing + active milestone context when relevant.
 * - PreToolUse (swarm | invoke_subagent): enforces configured models/tiers via `overwrite`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, resolveRoleFromTarget } from './lib/config.mjs';
import { finishRunningAgents, updateAgentActivity } from './lib/plans.mjs';

/**
 * Pure handler for PreInvocation hook input (no-op to avoid spamming trajectory system messages).
 */
export function handlePreInvocation() {
  return {};
}

function recordRunning(workspace, role, summary) {
  if (!workspace || !role) return;
  try {
    updateAgentActivity(workspace, role, 'running', summary || '');
  } catch {
    // Non-fatal telemetry failure must never block delegation.
  }
}

function recordFinished(workspace, role = null) {
  if (!workspace) return;
  try {
    finishRunningAgents(workspace, role, 'done');
  } catch {
    // Non-fatal telemetry failure must never block cleanup.
  }
}

/**
 * Pure handler for PreToolUse hook input (swarm, invoke_subagent, and manage_subagents).
 */
export function handlePreToolUse(input) {
  const tool = input?.toolCall;
  if (!tool || typeof tool.name !== 'string') return { decision: 'allow' };

  const workspace = input?.workspacePaths?.[0] || input?.cwd || '';
  const { effective } = loadConfig(workspace);
  const args = tool.args && typeof tool.args === 'object' ? tool.args : {};

  if (tool.name === 'swarm') {
    if (args.action === 'kill') {
      const role = resolveRoleFromTarget(args.name);
      recordFinished(workspace, role);
      return { decision: 'allow' };
    }
    if (args.action !== 'add' && args.action !== 'model') {
      return { decision: 'allow' };
    }
    const role = resolveRoleFromTarget(args.name);
    if (!role) return { decision: 'allow' };

    const configuredModel = effective.agents[role]?.model;
    recordRunning(workspace, role, args.name || '');
    if (!configuredModel) return { decision: 'allow' };
    return {
      decision: 'allow',
      overwrite: { model: configuredModel },
    };
  }

  if (tool.name === 'manage_subagents') {
    if (args.Action === 'kill_all' || args.Action === 'kill') {
      recordFinished(workspace, null);
    }
    return { decision: 'allow' };
  }

  if (tool.name === 'invoke_subagent') {
    // Antigravity CLI may batch Subagents[]; Antigravity 2.0 passes flat args.TypeName.
    if (Array.isArray(args.Subagents)) {
      const updated = args.Subagents.map((sub) => {
        const role = resolveRoleFromTarget(sub?.TypeName || sub?.Role);
        const tier = role ? effective.agents[role]?.tier : null;
        recordRunning(workspace, role, sub?.Role || sub?.TypeName || '');
        return tier ? { ...sub, Model: tier } : sub;
      });
      return { decision: 'allow', overwrite: { Subagents: updated } };
    }

    const role = resolveRoleFromTarget(args.TypeName || args.Role);
    if (!role) return { decision: 'allow' };
    recordRunning(workspace, role, args.Role || args.TypeName || '');
    const tier = effective.agents[role]?.tier;
    if (!tier) return { decision: 'allow' };
    return {
      decision: 'allow',
      overwrite: { Model: tier },
    };
  }

  return { decision: 'allow' };
}

/**
 * Pure handler for Stop hook input: transitions running agents to done once background tasks are idle.
 */
export function handleStop(input) {
  const workspace = input?.workspacePaths?.[0] || input?.cwd || '';
  const canceled = input?.terminationReason === 'USER_CANCELED' || input?.terminationReason === 'ERROR';
  if (workspace && (input?.fullyIdle !== false || canceled)) {
    recordFinished(workspace, null);
  }
  return {};
}

function main() {
  const mode = process.argv[2] || '';
  let input = {};
  try {
    const raw = readFileSync(0, 'utf8').trim();
    if (raw) input = JSON.parse(raw);
  } catch {
    input = {};
  }

  const output = mode === 'pre-invocation'
    ? handlePreInvocation(input)
    : mode === 'pre-tool'
      ? handlePreToolUse(input)
      : mode === 'stop'
        ? handleStop(input)
        : {};
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
