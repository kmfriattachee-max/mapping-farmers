const fs = require('fs');
const vm = require('vm');
try {
  const code = fs.readFileSync('public/app.js', 'utf8');
  new vm.Script(code);
  console.log('OK');
} catch (e) {
  console.error('SYNTAX_ERROR', e && e.stack ? e.stack : e);
  process.exitCode = 2;
}
