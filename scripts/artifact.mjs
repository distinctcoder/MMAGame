// Turns dist/index.html into dist/artifact.html for publishing as a claude.ai artifact.
// The artifact viewer supplies the document shell (doctype, html, head, body, charset and viewport),
// so this strips those wrapper tags, inlines the stylesheet, and keeps the relative link to the game script.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const out = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  // Inline the built stylesheet so the page does not depend on loading a second CSS file.
  .replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/, (_, file) => `<style>${readFileSync('dist/' + file, 'utf8')}</style>`);
writeFileSync('dist/artifact.html', out.trim() + '\n');
console.log('Wrote dist/artifact.html');

// Artifacts don't serve .glb files, so each model also goes out as base64 in a .json the game falls back to.
if (existsSync('dist/models')) {
  for (const f of readdirSync('dist/models').filter(n => n.endsWith('.glb'))) {
    writeFileSync(`dist/models/${f}.json`, JSON.stringify({ glb: readFileSync(`dist/models/${f}`).toString('base64') }));
    console.log(`Wrote dist/models/${f}.json`);
  }
}
