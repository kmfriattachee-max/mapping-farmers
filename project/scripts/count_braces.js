const fs = require('fs');
const p = 'public/app.js';
const code = fs.readFileSync(p,'utf8');
const counts = { '(':0, ')':0, '{':0, '}':0, '[':0, ']':0 };
for (const ch of code) if (ch in counts) counts[ch]++;
console.log('counts', counts);
// print last 60 lines to inspect tail
const lines = code.split(/\r?\n/);
const tail = lines.slice(-80).map((l,i)=>`${lines.length-80+i+1}: ${l}`);
console.log('tail:\n'+tail.join('\n'));
