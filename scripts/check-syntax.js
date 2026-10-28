// Syntax-checks all backend and browser JavaScript (CI + local: npm run check)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = ['server.js', 'routes', 'middleware', 'utils', 'services', 'config', 'js', 'tests'];
const files = [];
const walk = (p) => {
  const stat = fs.statSync(p);
  if (stat.isDirectory()) fs.readdirSync(p).forEach((f) => walk(path.join(p, f)));
  else if (p.endsWith('.js')) files.push(p);
};
roots.filter((r) => fs.existsSync(r)).forEach(walk);

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(`Syntax error in ${file}:\n${e.stderr.toString()}`);
  }
}
console.log(`Checked ${files.length} files, ${failed} with syntax errors`);
process.exit(failed ? 1 : 0);
