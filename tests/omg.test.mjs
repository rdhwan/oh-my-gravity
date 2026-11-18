import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

import {
  DEFAULT_CONFIG,
  deriveTier,
  loadConfig,
  resetConfig,
  resolveRoleBackend,
  resolveRoleFromTarget,
  saveConfig,
} from '../scripts/lib/config.mjs';
import {
  initPlanTopic,
  loadTodoState,
  updateAgentActivity,
  updateMilestoneStatus,
  updateTodoItem,
  writePlanDocs,
} from '../scripts/lib/plans.mjs';
import { handlePreInvocation, handlePreToolUse, handleStop } from '../scripts/hook-guard.mjs';
import { createPanelController } from '../sidecars/omg-panel/lib/server.mjs';

describe('oh-my-gravity plugin core', () => {
  let tmpRoot;
  let globalCfg;
  let workspace;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'omg-test-'));
    globalCfg = join(tmpRoot, 'gemini', 'config', 'omg', 'config.json');
    workspace = join(tmpRoot, 'workspace');
    mkdirSync(workspace, { recursive: true });
    process.env.OMG_GLOBAL_CONFIG = globalCfg;
  });

  afterEach(() => {
    delete process.env.OMG_GLOBAL_CONFIG;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('defaults to swarm backend and derives subagent tiers accurately', () => {
    const cfg = loadConfig(workspace).effective;
    assert.equal(cfg.backend, 'swarm');
    assert.equal(cfg.agents.explore.tier, 'flash_lite');
    assert.equal(deriveTier('gemini-3.8-flash-low'), 'flash_lite');
    assert.equal(deriveTier('gemini-4-hydrogen-medium'), 'flash');
    assert.equal(deriveTier('claude-opus-5-5-high'), 'pro');
  });

  it('merges global and workspace configs and resolves roles', () => {
    saveConfig({ agents: { explore: { model: 'gemini-3.8-flash-medium' } } }, 'global', workspace);
    saveConfig({ backend: 'subagent', agents: { build: { model: 'claude-sonnet-5-5-high', backend: 'swarm' } } }, 'workspace', workspace);

    const loaded = loadConfig(workspace);
    assert.equal(loaded.effective.backend, 'subagent');
    assert.equal(loaded.effective.agents.explore.model, 'gemini-3.8-flash-medium');
    assert.equal(loaded.effective.agents.build.model, 'claude-sonnet-5-5-high');
    assert.equal(resolveRoleBackend(loaded.effective, 'explore'), 'subagent');
    assert.equal(resolveRoleBackend(loaded.effective, 'build'), 'swarm');

    assert.equal(resolveRoleFromTarget('explore-scout'), 'explore');
    assert.equal(resolveRoleFromTarget('omg-oracle'), 'oracle');
    assert.equal(resolveRoleFromTarget('build-m2'), 'build');
  });

  it('creates plans/<topic>/*.md and syncs todo updates bidirectionally', () => {
    initPlanTopic(workspace, {
      topic: 'User Auth',
      title: 'User Authentication',
      milestones: [
        {
          id: 'm1',
          title: 'Milestone 1: Token Verification',
          goal: 'Verify JWT signatures on protected routes.',
          planSummary: '1. Add verify helper\n2. Add tests',
          todos: [
            { id: 't1', title: 'Add verify helper', assignee: 'build' },
            { id: 't2', title: 'Add auth tests', assignee: 'build' },
          ],
        },
      ],
    });

    const { planDir } = writePlanDocs(workspace, 'user-auth');
    assert.equal(planDir, 'plans/user-auth');
    const msPath = join(workspace, 'plans', 'user-auth', 'milestone-01-milestone-1-token-verification.md');
    assert.ok(existsSync(join(workspace, 'plans', 'user-auth', 'README.md')));
    assert.ok(existsSync(msPath));

    updateMilestoneStatus(workspace, 'user-auth', 'm1', 'in_progress');
    updateTodoItem(workspace, 'user-auth', 'm1', 't1', 'done', 'Implemented verifyToken');
    const mdAfter = readFileSync(msPath, 'utf8');
    assert.match(mdAfter, /- \[x\] \[build\] Add verify helper/);
    assert.match(mdAfter, /- \[ \] \[build\] Add auth tests/);

    // Simulate external manual edit of markdown checkbox -> loadTodoState picks it up
    writeFileSync(msPath, mdAfter.replace('- [ ] [build] Add auth tests', '- [x] [build] Add auth tests'), 'utf8');
    const reloaded = loadTodoState(workspace);
    assert.equal(reloaded.topics['user-auth'].milestones[0].status, 'done');
    assert.equal(reloaded.topics['user-auth'].milestones[0].todos[1].status, 'done');
  });

  it('enforces configured models via PreToolUse overwrite for swarm and invoke_subagent', () => {
    saveConfig({
      agents: {
        explore: { model: 'gemini-3.8-flash-low', tier: 'flash_lite' },
        oracle: { model: 'claude-opus-5-5-high', tier: 'pro' },
      },
    }, 'global', workspace);

    initPlanTopic(workspace, {
      topic: 'api-v2',
      title: 'API v2',
      milestones: [{ id: 'm1', title: 'M1', status: 'in_progress', todos: [] }],
    });

    const preInv = handlePreInvocation({ workspacePaths: [workspace] });
    assert.deepEqual(preInv, {});

    const swarmRes = handlePreToolUse({
      workspacePaths: [workspace],
      toolCall: {
        name: 'swarm',
        args: { action: 'add', name: 'oracle-check', model: 'gemini-3.8-flash-low' },
      },
    });
    assert.equal(swarmRes.decision, 'allow');
    assert.equal(swarmRes.overwrite.model, 'claude-opus-5-5-high');

    const subRes = handlePreToolUse({
      workspacePaths: [workspace],
      toolCall: {
        name: 'invoke_subagent',
        args: { TypeName: 'omg-explorer', Model: 'pro', Role: 'Scout', Prompt: 'Find routes' },
      },
    });
    assert.equal(subRes.overwrite.Model, 'flash_lite');

    const state = loadTodoState(workspace);
    assert.equal(state.agents.oracle.status, 'running');
    assert.equal(state.agents.explore.status, 'running');

    handlePreToolUse({
      workspacePaths: [workspace],
      toolCall: { name: 'swarm', args: { action: 'kill', name: 'oracle-check' } },
    });
    assert.equal(loadTodoState(workspace).agents.oracle.status, 'done');
    assert.equal(loadTodoState(workspace).agents.explore.status, 'running');

    handleStop({ workspacePaths: [workspace], fullyIdle: true });
    assert.equal(loadTodoState(workspace).agents.explore.status, 'done');
  });

  it('serves and updates config, models, todos, and context report via sidecar controller', async () => {
    const convDir = join(tmpRoot, 'conversations');
    mkdirSync(convDir, { recursive: true });
    const convId = '11111111-2222-3333-4444-555555555555';
    const childId = '22222222-3333-4444-5555-666666666666';
    writeFileSync(join(convDir, `${convId}.db`), 'stub', 'utf8');
    writeFileSync(join(convDir, `${childId}.db`), 'stub', 'utf8');
    const catalogPath = join(tmpRoot, 'model-catalog.json');
    writeFileSync(catalogPath, JSON.stringify({
      'gemini-4-argon-high': { maxTokens: 1048576, displayName: 'Gemini 4 Argon (High)' },
      'gemini-3.8-flash-low': { maxTokens: 1048576, displayName: 'Gemini 3.8 Flash (Low)' },
    }));

    let reportCalls = 0;
    const ctrl = createPanelController({
      conversationsDir: convDir,
      catalogPath,
      refreshCatalog: async () => {},
      discoverChildren: async () => [{ conversation_id: childId, label: 'Scout', role: 'omg-explorer', source: 'subagent' }],
      runContextReport: async ({ db }) => {
        reportCalls += 1;
        if (db.endsWith(`${childId}.db`)) {
          return {
            model: 'Gemini 3.8 Flash (Low)',
            model_id: 'gemini-3.8-flash-low',
            used_tokens: 400,
            limit_tokens: 1048576,
            used_pct: 0.1,
            token_usage: { latest: { input_tokens: 300, output_tokens: 50, cached_tokens: 100 }, session: { input_tokens: 300, output_tokens: 50, cached_tokens: 100, thinking_tokens: 0 } },
          };
        }
        return {
          model: 'Gemini 4 Hydrogen (High)',
          model_id: 'gemini-4-hydrogen-high',
          used_tokens: 1200,
          limit_tokens: 1048576,
          used_pct: 0.1,
          token_usage: { latest: { input_tokens: 900, output_tokens: 200, cached_tokens: 300 }, session: { input_tokens: 900, output_tokens: 200, cached_tokens: 300, thinking_tokens: 20 } },
        };
      },
    });

    const r1 = await ctrl.getReport({ conversationId: convId, workspace });
    const r2 = await ctrl.getReport({ conversationId: convId, workspace });
    assert.equal(r1.used_tokens, 1200);
    assert.equal(r2.used_tokens, 1200);
    assert.equal(reportCalls, 1, 'identical db stamp should use report cache');

    const agentsRes = await ctrl.getAgents({ conversationId: convId, workspace });
    assert.equal(agentsRes.agents.length, 2);
    assert.equal(agentsRes.totals.input_tokens, 1200);
    assert.equal(agentsRes.totals.output_tokens, 250);
    assert.equal(agentsRes.totals.cached_tokens, 400);

    const models = await ctrl.getModels();
    assert.equal(models.source, 'live');
    assert.ok(models.models.length >= 18);
    assert.ok(models.models.some((m) => m.id === 'gemini-4-hydrogen-high'));

    const saved = await ctrl.saveConfigHandler({
      scope: 'global',
      workspace,
      patch: { agents: { build: { model: 'gemini-4-argon-high' } } },
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.roles.length, 6);
    assert.equal(saved.effective.agents.build.model, 'gemini-4-argon-high');
    assert.equal(saved.effective.agents.build.tier, 'pro');

    initPlanTopic(workspace, {
      topic: 'ui',
      title: 'UI',
      milestones: [{ id: 'm1', title: 'M1', todos: [{ id: 't1', title: 'Check panel', assignee: 'build' }] }],
    });
    updateAgentActivity(workspace, 'build', 'running', 'build-m1');
    const todosRes = await ctrl.getTodos({ workspace });
    assert.equal(todosRes.agents.build.status, 'running');

    const cleared = await ctrl.clearAgents({ workspace });
    assert.deepEqual(cleared.state.agents, {});

    const toggled = await ctrl.toggleTodo({
      workspace,
      topic: 'ui',
      milestoneId: 'm1',
      todoId: 't1',
      status: 'done',
    });
    assert.equal(toggled.state.topics.ui.milestones[0].todos[0].status, 'done');

    const resetRes = await ctrl.resetConfigHandler({ scope: 'global', workspace });
    assert.equal(resetRes.roles.length, 6);
    assert.equal(resetRes.effective.agents.build.model, DEFAULT_CONFIG.agents.build.model);
  });

  it('executes hook-guard.mjs and omg-state.mjs as CLI subprocesses', () => {
    const planPayload = JSON.stringify({
      topic: 'cli-test',
      title: 'CLI Test',
      milestones: [{ id: 'm1', title: 'M1', todos: [{ id: 't1', title: 'Step 1', assignee: 'build' }] }],
    });
    execFileSync(process.execPath, ['scripts/omg-state.mjs', 'init-plan', '--workspace', workspace], {
      cwd: REPO_ROOT,
      input: planPayload,
      encoding: 'utf8',
    });
    execFileSync(process.execPath, ['scripts/omg-state.mjs', 'todo-update', 'm1', 't1', 'done', '--workspace', workspace, '--topic', 'cli-test'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const statusOut = JSON.parse(execFileSync(process.execPath, ['scripts/omg-state.mjs', 'status', '--workspace', workspace], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }));
    assert.equal(statusOut.state.topics['cli-test'].milestones[0].status, 'done');

    const hookOut = JSON.parse(execFileSync(process.execPath, ['./scripts/hook-guard.mjs', 'pre-tool'], {
      cwd: REPO_ROOT,
      input: JSON.stringify({
        workspacePaths: [workspace],
        toolCall: { name: 'swarm', args: { action: 'add', name: 'explore-cli', model: 'wrong-model' } },
      }),
      encoding: 'utf8',
    }));
    assert.equal(hookOut.overwrite.model, DEFAULT_CONFIG.agents.explore.model);
  });
});
