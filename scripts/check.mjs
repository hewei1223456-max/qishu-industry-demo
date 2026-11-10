import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const errors = [];
let scripts = 0;
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'data', '.git', 'assets'].includes(item.name)) continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else if (/\.(?:js|mjs|cjs)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      scripts++;
      if (result.status !== 0) errors.push({ file: path.relative(root, file), message: result.stderr });
    } else if (file.endsWith('.json')) {
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        errors.push({ file: path.relative(root, file), message: error.message });
      }
    }
  }
}
walk(path.join(root, 'apps'));
walk(path.join(root, 'packages'));
if (errors.length) {
  console.error(JSON.stringify({ checkedScripts: scripts, errors }, null, 2));
  process.exitCode = 1;
} else console.log(JSON.stringify({ checkedScripts: scripts, syntax: 'pass' }));
