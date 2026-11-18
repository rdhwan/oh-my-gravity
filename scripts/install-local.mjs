#!/usr/bin/env node
/**
 * Symlink (or copy with --copy) this plugin repo into ~/.gemini/config/plugins/omg
 * for local testing in Antigravity 2.0.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGeminiDir } from './lib/io.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(getGeminiDir(), 'config', 'plugins');
const targetDir = join(pluginsDir, 'omg');
const useCopy = process.argv.includes('--copy');
const uninstall = process.argv.includes('--uninstall');

mkdirSync(pluginsDir, { recursive: true });

if (existsSync(targetDir) || (() => { try { lstatSync(targetDir); return true; } catch { return false; } })()) {
  rmSync(targetDir, { recursive: true, force: true });
}

if (uninstall) {
  console.log(`Removed ${targetDir}`);
  process.exit(0);
}

if (useCopy) {
  cpSync(repoRoot, targetDir, {
    recursive: true,
    filter: (src) => !src.includes('study-materials') && !src.includes('.git') && !src.includes('.omg'),
  });
  console.log(`Copied plugin to ${targetDir}`);
} else {
  symlinkSync(repoRoot, targetDir, 'dir');
  console.log(`Linked ${targetDir} -> ${repoRoot}`);
}
console.log('Open Customizations in Antigravity 2.0 and enable "oh-my-gravity (OMG)".');
