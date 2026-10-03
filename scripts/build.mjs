import { mkdir, cp, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
export async function buildAssets() {
await mkdir('dist/public/vendor/htmx', { recursive: true });
await cp('public', 'dist/public', { recursive: true });
await copyFile('node_modules/htmx.org/dist/htmx.min.js', 'dist/public/vendor/htmx/htmx.min.js');
await build({
  entryPoints: ['src/client/app.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/public/static/js/app.js',
});
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildAssets();
