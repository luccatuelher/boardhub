// Optional precompiled build: `npm run build` writes dist/index.html.
//
// The source index.html stays the deployable, no-build file. This script
// compiles its JSX once (the same Babel version and options the in-browser
// loader uses), inlines the result as a plain <script>, drops the Babel loader
// and its IndexedDB bundle cache, and pins the CDN scripts with SRI hashes
// computed from the exact npm packages they are served from. That removes
// Babel and `new Function` from the page, which is what a CSP without
// 'unsafe-eval' needs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Babel = require('@babel/standalone');

let html = readFileSync(join(root, 'index.html'), 'utf8');

const OPEN = '<script type="text/x-boardhub-jsx" id="bh-jsx-source">';
const a = html.indexOf(OPEN);
const b = html.indexOf('</script>', a);
if (a < 0 || b < 0) throw new Error('JSX source block not found');
const source = html.slice(a + OPEN.length, b);

const { code } = Babel.transform(source, { presets: [['react', { runtime: 'classic' }]], sourceType: 'script' });
const safe = code.replace(/<\/script/gi, '<\\/script');

// Same contract as the loader: run once React/ReactDOM (deferred) are ready,
// and report a failed boot through the splash error handler.
const bundle = `<script id="bh-bundle">
window.__bhBundleCache={key:'precompiled',source:'precompiled',clear:function(){return Promise.resolve(true);}};
(function(){
function run(){
try{
${safe}
}catch(e){
console.error('[BoardHub] boot falhou:',e);
window.dispatchEvent(new ErrorEvent('error',{message:'Falha ao inicializar: '+(e&&e.message||e)}));
}
}
if(window.React&&window.ReactDOM)run();else document.addEventListener('DOMContentLoaded',run);
})();
</script>`;
html = html.slice(0, a) + bundle + html.slice(b + '</script>'.length);

// Drop the in-browser loader (the last script that mentions BABEL_URL).
const loaderAt = html.lastIndexOf('<script>\n(function(){\n  var BABEL_URL=');
if (loaderAt < 0) throw new Error('Babel loader block not found');
const loaderEnd = html.indexOf('</script>', loaderAt) + '</script>'.length;
html = html.slice(0, loaderAt) + html.slice(loaderEnd);

// SRI for the three critical CDN scripts, hashed from the pinned npm packages.
const pins = [
  ['https://unpkg.com/react@18.3.1/umd/react.production.min.js', 'react/umd/react.production.min.js'],
  ['https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js', 'react-dom/umd/react-dom.production.min.js'],
  ['https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js', 'lucide/dist/umd/lucide.min.js'],
];
for (const [url, file] of pins) {
  const data = readFileSync(join(root, 'node_modules', file));
  const sri = 'sha384-' + createHash('sha384').update(data).digest('base64');
  const tag = new RegExp(`<script defer src="${url.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"( crossorigin)?>`);
  if (!tag.test(html)) throw new Error('script tag not found: ' + url);
  html = html.replace(tag, `<script defer src="${url}" integrity="${sri}" crossorigin="anonymous">`);
}

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), html);
console.log(`dist/index.html written (${(html.length / 1024).toFixed(0)} KB, source ${(source.length / 1024).toFixed(0)} KB)`);
