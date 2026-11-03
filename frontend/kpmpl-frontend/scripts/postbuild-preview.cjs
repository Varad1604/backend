// Turns the single-file build into a classic (non-module) page: the inline script is
// moved to the end of <body> so #root exists when it runs. Used only by build:preview.
const fs = require('fs');
const f = 'dist/index.html';
let s = fs.readFileSync(f, 'utf8');
const m = s.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
if (!m) throw new Error('module script not found');
s = s.replace(m[0], () => '');
const body = m[1].replace(/<\/script/gi, () => '<\\/script');
s = s.replace('</body>', () => `<script>${body}</script>\n</body>`); // function replacers: bundle contains `$` patterns
if (/type="module"/.test(s)) throw new Error('module script still present');
fs.writeFileSync(f, s);
console.log('preview: classic script OK, import.meta occurrences =', (s.match(/import\.meta/g) || []).length);
