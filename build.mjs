// Build the browser app into dist/ with esbuild (no other build tools needed).
import { build } from 'esbuild';
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// Allow building from a shared node_modules folder (NODE_PATH) as well as a local install.
const nodePaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/assets', { recursive: true });

await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/assets/app.js',
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  target: ['es2022'],
  nodePaths,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

cpSync('index.html', 'dist/index.html');
cpSync('public', 'dist', { recursive: true });
const pdfWorker = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs', { paths: [process.cwd(), ...nodePaths] });
cpSync(pdfWorker, 'dist/pdf.worker.min.mjs');
console.log('Built dist/', existsSync('dist/assets/app.js') ? 'OK' : 'MISSING');
