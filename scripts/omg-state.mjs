#!/usr/bin/env node
/**
 * OMG state & plan CLI used by the Orchestrator to keep milestones, sub-todos,
 * plans/<topic>/*.md checklists, and sidebar telemetry synchronized.
 */
import { readFileSync } from 'node:fs';
import { loadConfig } from './lib/config.mjs';
import {
  initPlanTopic,
  loadTodoState,
  updateAgentActivity,
  updateMilestoneStatus,
  updateTodoItem,
  writePlanDocs,
} from './lib/plans.mjs';

function parseFlags(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = 'true';
      }
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

function readJsonInput(flags) {
  if (flags.file) return JSON.parse(readFileSync(flags.file, 'utf8'));
  if (flags.json) return JSON.parse(flags.json);
  const stdin = readFileSync(0, 'utf8').trim();
  return stdin ? JSON.parse(stdin) : {};
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, pos } = parseFlags(rest);
  const workspace = flags.workspace || process.cwd();

  switch (cmd) {
    case 'status': {
      const state = loadTodoState(workspace);
      const cfg = loadConfig(workspace).effective;
      console.log(JSON.stringify({ state, config: cfg }, null, 2));
      return;
    }
    case 'init-plan': {
      const payload = readJsonInput(flags);
      const state = initPlanTopic(workspace, {
        topic: flags.topic || payload.topic,
        title: flags.title || payload.title,
        milestones: payload.milestones || [],
        planDir: flags['plan-dir'] || payload.planDir || '',
      });
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    case 'write-plans': {
      const res = writePlanDocs(workspace, flags.topic || pos[0]);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    case 'sync-plans': {
      const state = loadTodoState(workspace);
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    case 'milestone-status': {
      const [milestoneId, status] = pos;
      const state = updateMilestoneStatus(workspace, flags.topic, milestoneId, status);
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    case 'todo-update': {
      const [milestoneId, todoId, status, ...noteParts] = pos;
      const note = flags.note ?? (noteParts.length ? noteParts.join(' ') : undefined);
      const state = updateTodoItem(workspace, flags.topic, milestoneId, todoId, status, note);
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    case 'agent-activity': {
      const [role, status, ...summaryParts] = pos;
      const state = updateAgentActivity(workspace, role, status, summaryParts.join(' '));
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    default: {
      console.error(
        'Usage: omg-state.mjs <status|init-plan|write-plans|sync-plans|milestone-status|todo-update|agent-activity> [--workspace <dir>]'
      );
      process.exit(1);
    }
  }
}

main();
