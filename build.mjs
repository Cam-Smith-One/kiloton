// Usage: node build.mjs [entry=src/main.js] [out=index] [--dev]
// Bundles entry + three into ONE self-contained html at dist/<out>.html using src/shell.html.
import { build } from 'esbuild';
import fs from 'node:fs';
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const dev = process.argv.includes('--dev');
const entry = args[0] || 'src/main.js';
const out = args[1] || 'index';
const r = await build({
  entryPoints: [entry], bundle: true, format: 'iife', write: false,
  minify: !dev, target: 'es2022', legalComments: 'none',
  loader: { '.glsl': 'text' }, logLevel: 'warning',
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const shell = fs.readFileSync('src/shell.html', 'utf8');
if (!shell.includes('/*__BUNDLE__*/')) throw new Error('shell.html lacks bundle marker');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync(`dist/${out}.html`, shell.replace('/*__BUNDLE__*/', () => js));
console.log(`dist/${out}.html  ${(js.length / 1024).toFixed(0)} KB js`);
