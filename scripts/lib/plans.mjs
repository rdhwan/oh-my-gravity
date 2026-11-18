import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonSafe, resolveWorkspacePath, slugify, writeJsonAtomic, writeTextAtomic } from './io.mjs';

export const MILESTONE_STATUSES = ['pending', 'in_progress', 'verifying', 'done', 'blocked'];
export const TODO_STATUSES = ['pending', 'in_progress', 'done', 'blocked'];

/**
 * Resolve paths to workspace OMG state and plans folders.
 */
export function getStatePaths(workspaceUriOrPath) {
  const root = resolveWorkspacePath(workspaceUriOrPath);
  if (!root) return { root: '', stateFile: '', plansDir: '' };
  return {
    root,
    stateFile: join(root, '.omg', 'state', 'todos.json'),
    plansDir: join(root, 'plans'),
  };
}

function emptyState() {
  return {
    version: 1,
    activeTopic: '',
    updatedAt: new Date().toISOString(),
    agents: {},
    topics: {},
  };
}

function normalizeTodo(todo, idx) {
  const raw = typeof todo === 'string' ? { title: todo } : (todo || {});
  const id = String(raw.id || `t${idx + 1}`);
  const status = TODO_STATUSES.includes(raw.status) ? raw.status : (raw.done ? 'done' : 'pending');
  return {
    id,
    title: String(raw.title || raw.text || `Todo ${idx + 1}`).trim(),
    status,
    assignee: String(raw.assignee || 'build').trim(),
    note: String(raw.note || '').trim(),
  };
}

function normalizeMilestone(ms, idx) {
  const raw = ms || {};
  const id = String(raw.id || `m${idx + 1}`);
  const todos = Array.isArray(raw.todos) ? raw.todos.map(normalizeTodo) : [];
  const status = MILESTONE_STATUSES.includes(raw.status) ? raw.status : inferMilestoneStatus(todos);
  return {
    id,
    title: String(raw.title || `Milestone ${idx + 1}`).trim(),
    goal: String(raw.goal || '').trim(),
    planSummary: String(raw.planSummary || '').trim(),
    file: String(raw.file || '').trim(),
    status,
    todos,
  };
}

function inferMilestoneStatus(todos) {
  if (!todos.length) return 'pending';
  if (todos.every((t) => t.status === 'done')) return 'done';
  if (todos.some((t) => t.status === 'blocked')) return 'blocked';
  if (todos.some((t) => t.status === 'in_progress' || t.status === 'done')) return 'in_progress';
  return 'pending';
}

/**
 * Parse a milestone markdown file under plans/<topic>/milestone-*.md.
 */
export function parseMilestoneMarkdown(content, relPath, idx) {
  const lines = String(content || '').split(/\r?\n/);
  let title = `Milestone ${idx + 1}`;
  let goal = '';
  let section = '';
  const planLines = [];
  const todos = [];

  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 && title === `Milestone ${idx + 1}`) {
      title = h1[1].trim();
      continue;
    }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      section = h2[1].trim().toLowerCase();
      continue;
    }
    const task = /^\s*-\s+\[([ xX~!-])\]\s+(.+)$/.exec(line);
    if (task) {
      const mark = task[1];
      const rawText = task[2].trim();
      const roleMatch = /^\[([a-zA-Z_-]+)\]\s+(.+)$/.exec(rawText);
      const assignee = roleMatch ? roleMatch[1].toLowerCase() : 'build';
      const label = roleMatch ? roleMatch[2].trim() : rawText;
      const status = mark === 'x' || mark === 'X' ? 'done' : mark === '~' ? 'in_progress' : mark === '!' ? 'blocked' : 'pending';
      todos.push({ id: `t${todos.length + 1}`, title: label, status, assignee, note: '' });
      continue;
    }
    if (section.includes('goal') && line.trim()) {
      goal = goal ? `${goal} ${line.trim()}` : line.trim();
    } else if (section.includes('plan') || section.includes('implementation')) {
      if (line.trim()) planLines.push(line.trim());
    }
  }

  return normalizeMilestone({
    id: `m${idx + 1}`,
    title,
    goal,
    planSummary: planLines.slice(0, 6).join('\n'),
    file: relPath,
    todos,
  }, idx);
}

/**
 * Scan <workspace>/plans/<topic>/ directories and merge with persisted state.
 */
export function loadTodoState(workspaceUriOrPath) {
  const { root, stateFile, plansDir } = getStatePaths(workspaceUriOrPath);
  if (!root) return emptyState();
  const state = readJsonSafe(stateFile, emptyState()) || emptyState();
  state.topics = state.topics && typeof state.topics === 'object' ? state.topics : {};
  state.agents = state.agents && typeof state.agents === 'object' ? state.agents : {};

  if (existsSync(plansDir)) {
    const entries = readdirSync(plansDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const dir of entries) {
      const slug = dir.name;
      const topicDir = join(plansDir, slug);
      const mdFiles = readdirSync(topicDir)
        .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
        .sort();
      if (!mdFiles.length) continue;

      let topicTitle = slug;
      const readmePath = join(topicDir, 'README.md');
      if (existsSync(readmePath)) {
        const firstHeading = /^#\s+(.+)$/m.exec(readFileSync(readmePath, 'utf8'));
        if (firstHeading) topicTitle = firstHeading[1].trim();
      }

      const existingTopic = state.topics[slug];
      const parsedMilestones = mdFiles.map((file, idx) => {
        const rel = join('plans', slug, file).replace(/\\/g, '/');
        const parsed = parseMilestoneMarkdown(readFileSync(join(topicDir, file), 'utf8'), rel, idx);
        const prev = existingTopic?.milestones?.find((m) => m.file === rel || m.id === parsed.id);
        if (prev) {
          // Preserve verifying/in_progress status when markdown doesn't distinguish verifying from in_progress
          if (prev.status === 'verifying' && parsed.status !== 'done') parsed.status = 'verifying';
          parsed.todos = parsed.todos.map((t, tIdx) => {
            const prevTodo = prev.todos?.[tIdx];
            if (prevTodo?.note && !t.note) t.note = prevTodo.note;
            if (t.status === 'pending' && prevTodo?.status === 'in_progress') t.status = 'in_progress';
            return t;
          });
        }
        return parsed;
      });

      state.topics[slug] = {
        slug,
        title: existingTopic?.title || topicTitle,
        planDir: join('plans', slug).replace(/\\/g, '/'),
        updatedAt: existingTopic?.updatedAt || new Date().toISOString(),
        milestones: parsedMilestones,
      };
      if (!state.activeTopic) state.activeTopic = slug;
    }
  }

  return state;
}

/**
 * Create or replace a topic's structured milestone plan in .omg/state/todos.json.
 */
export function initPlanTopic(workspaceUriOrPath, { topic, title, milestones, planDir = '' }) {
  const { root, stateFile } = getStatePaths(workspaceUriOrPath);
  if (!root) throw new Error('Workspace path is required.');
  const state = loadTodoState(root);
  const slug = slugify(topic || title, 'default-plan');
  state.topics[slug] = {
    slug,
    title: String(title || slug).trim(),
    planDir: planDir || state.topics[slug]?.planDir || '',
    updatedAt: new Date().toISOString(),
    milestones: (Array.isArray(milestones) ? milestones : []).map(normalizeMilestone),
  };
  state.activeTopic = slug;
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(stateFile, state);
  return state;
}

/**
 * Update a markdown checklist item line matching its index or label.
 */
function syncMarkdownCheckbox(root, relFile, todoIndex, todoTitle, nextStatus) {
  if (!relFile) return;
  const fullPath = join(root, relFile);
  if (!existsSync(fullPath)) return;
  const lines = readFileSync(fullPath, 'utf8').split(/\r?\n/);
  const mark = nextStatus === 'done' ? 'x' : nextStatus === 'in_progress' ? '~' : nextStatus === 'blocked' ? '!' : ' ';
  let seen = 0;
  let updated = false;

  const nextLines = lines.map((line) => {
    const match = /^(\s*-\s+\[)([ xX~!-])(\]\s+)(.+)$/.exec(line);
    if (!match) return line;
    const isTarget = seen === todoIndex || match[4].toLowerCase().includes(todoTitle.toLowerCase());
    seen += 1;
    if (!updated && isTarget) {
      updated = true;
      return `${match[1]}${mark}${match[3]}${match[4]}`;
    }
    return line;
  });

  if (updated) {
    writeTextAtomic(fullPath, `${nextLines.join('\n')}\n`.replace(/\n\n$/, '\n'));
  }
}

/**
 * Update a milestone status and persist to todos.json.
 */
export function updateMilestoneStatus(workspaceUriOrPath, topicSlug, milestoneId, status) {
  if (!MILESTONE_STATUSES.includes(status)) {
    throw new Error(`Invalid milestone status "${status}". Expected one of: ${MILESTONE_STATUSES.join(', ')}`);
  }
  const { root, stateFile } = getStatePaths(workspaceUriOrPath);
  const state = loadTodoState(root);
  const slug = topicSlug || state.activeTopic;
  const topic = state.topics[slug];
  if (!topic) throw new Error(`Unknown topic "${slug}".`);
  const milestone = topic.milestones.find((m) => m.id === milestoneId);
  if (!milestone) throw new Error(`Unknown milestone "${milestoneId}" in topic "${slug}".`);

  milestone.status = status;
  topic.updatedAt = new Date().toISOString();
  state.updatedAt = topic.updatedAt;
  writeJsonAtomic(stateFile, state);
  return state;
}

/**
 * Update a sub-todo's status/note and sync its checkbox back to plans/<topic>/milestone-*.md if linked.
 */
export function updateTodoItem(workspaceUriOrPath, topicSlug, milestoneId, todoId, status, note = undefined) {
  if (!TODO_STATUSES.includes(status)) {
    throw new Error(`Invalid todo status "${status}". Expected one of: ${TODO_STATUSES.join(', ')}`);
  }
  const { root, stateFile } = getStatePaths(workspaceUriOrPath);
  const state = loadTodoState(root);
  const slug = topicSlug || state.activeTopic;
  const topic = state.topics[slug];
  if (!topic) throw new Error(`Unknown topic "${slug}".`);
  const milestone = topic.milestones.find((m) => m.id === milestoneId);
  if (!milestone) throw new Error(`Unknown milestone "${milestoneId}" in topic "${slug}".`);
  const todoIdx = milestone.todos.findIndex((t) => t.id === todoId);
  if (todoIdx < 0) throw new Error(`Unknown todo "${todoId}" in milestone "${milestoneId}".`);

  const todo = milestone.todos[todoIdx];
  todo.status = status;
  if (note !== undefined) todo.note = String(note).trim();

  if (milestone.status !== 'verifying') {
    milestone.status = inferMilestoneStatus(milestone.todos);
  }
  topic.updatedAt = new Date().toISOString();
  state.updatedAt = topic.updatedAt;
  writeJsonAtomic(stateFile, state);
  syncMarkdownCheckbox(root, milestone.file, todoIdx, todo.title, status);
  return state;
}

/**
 * Record live subagent execution status for sidebar visibility.
 */
export function updateAgentActivity(workspaceUriOrPath, role, status, summary = '') {
  const { root, stateFile } = getStatePaths(workspaceUriOrPath);
  if (!root) throw new Error('Workspace path is required.');
  const state = loadTodoState(root);
  state.agents[role] = {
    status: String(status || 'idle'),
    summary: String(summary || '').trim(),
    updatedAt: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(stateFile, state);
  return state;
}

/**
 * Mark a specific running role (or all running roles) as done/idle when workers finish or are killed.
 */
export function finishRunningAgents(workspaceUriOrPath, targetRole = null, nextStatus = 'done') {
  const { root, stateFile } = getStatePaths(workspaceUriOrPath);
  if (!root) return null;
  const state = loadTodoState(root);
  let changed = false;
  const now = new Date().toISOString();

  for (const [role, info] of Object.entries(state.agents || {})) {
    if (targetRole && role !== targetRole) continue;
    if (info?.status === 'running') {
      state.agents[role] = { ...info, status: nextStatus, updatedAt: now };
      changed = true;
    }
  }

  if (changed) {
    state.updatedAt = now;
    writeJsonAtomic(stateFile, state);
  }
  return state;
}

/**
 * Clear all agent activity chips from todos.json.
 */
export function clearAgentsActivity(workspaceUriOrPath) {
  const { root, stateFile } = getStatePaths(workspaceUriOrPath);
  if (!root) throw new Error('Workspace path is required.');
  const state = loadTodoState(root);
  state.agents = {};
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(stateFile, state);
  return state;
}

/**
 * Materialize a topic's plans/<topic-slug>/README.md and milestone-*.md files from structured JSON.
 */
export function writePlanDocs(workspaceUriOrPath, topicSlug) {
  const { root, stateFile, plansDir } = getStatePaths(workspaceUriOrPath);
  const state = loadTodoState(root);
  const topic = state.topics[topicSlug || state.activeTopic];
  if (!topic) throw new Error(`Unknown topic "${topicSlug || state.activeTopic}".`);

  const topicDir = join(plansDir, topic.slug);
  const indexRows = topic.milestones.map((m, idx) => {
    const fileName = `milestone-${String(idx + 1).padStart(2, '0')}-${slugify(m.title, m.id)}.md`;
    const rel = join('plans', topic.slug, fileName).replace(/\\/g, '/');
    m.file = rel;
    const todosBlock = m.todos.length
      ? m.todos.map((t) => {
          const mark = t.status === 'done' ? 'x' : t.status === 'in_progress' ? '~' : t.status === 'blocked' ? '!' : ' ';
          return `- [${mark}] [${t.assignee}] ${t.title}`;
        }).join('\n')
      : '- [ ] [build] Implement milestone tasks';

    const md = [
      `# ${m.title}`,
      '',
      '## Goal',
      m.goal || 'Deliver the scoped milestone cleanly and verify acceptance criteria.',
      '',
      '## Implementation Plan',
      m.planSummary || '1. Inspect scoped interfaces.\n2. Implement changes.\n3. Run scoped checks.',
      '',
      '## Todos',
      todosBlock,
      '',
    ].join('\n');
    writeTextAtomic(join(root, rel), md);
    return `- [${m.title}](./${fileName}) — ${m.goal || m.status}`;
  });

  const readme = [
    `# ${topic.title}`,
    '',
    `Topic slug: \`${topic.slug}\``,
    '',
    '## Milestones',
    ...indexRows,
    '',
  ].join('\n');
  writeTextAtomic(join(topicDir, 'README.md'), readme);

  topic.planDir = join('plans', topic.slug).replace(/\\/g, '/');
  topic.updatedAt = new Date().toISOString();
  state.updatedAt = topic.updatedAt;
  writeJsonAtomic(stateFile, state);
  return { planDir: topic.planDir, state };
}
