/**
 * Builds the game as ONE self-contained HTML file (dist-single/kota-baru.html) that runs
 * offline by double-clicking it. Run with: npm run build:single
 */
import { execSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, 'dist-single', 'tmp');
execSync('npx vite build --config vite.single.config.ts', { cwd: ROOT, stdio: 'inherit' });

const assets = path.join(TMP, 'assets');
const files = await readdir(assets);
const js = files.filter((f) => f.endsWith('.js'));
if (js.length !== 1) throw new Error(`expected one JS chunk, got ${js.join(', ')}`);
const script = (await readFile(path.join(assets, js[0]), 'utf8')).replaceAll('</script', '<\\/script');
const css = (await Promise.all(files.filter((f) => f.endsWith('.css')).map((f) => readFile(path.join(assets, f), 'utf8')))).join('\n');

const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
const body = html.match(/<body>([\s\S]*?)<script/)![1].trim();
const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>Kota Baru</title>
<style>${css}</style>
</head>
<body>
${body}
<script type="module">${script}</script>
</body>
</html>
`;
const outPath = path.join(ROOT, 'dist-single', 'kota-baru.html');
await writeFile(outPath, out);
await rm(TMP, { recursive: true, force: true });
console.log(`✔ ${path.relative(ROOT, outPath)} (${(out.length / 1024).toFixed(0)} KB)`);
