const fs = require('fs');
const path = require('path');

const jsDir = 'd:/Projects/rea/tizen-app/js';
const files = fs.readdirSync(jsDir);

let allValid = true;
for (const file of files) {
  if (!file.endsWith('.js') || file.includes('min.js')) continue;
  const filePath = path.join(jsDir, file);
  const code = fs.readFileSync(filePath, 'utf8');

  // Check ES6 patterns
  const patterns = [
    { name: 'const', re: /\bconst\s+[a-zA-Z0-9_$]+/ },
    { name: 'let', re: /\blet\s+[a-zA-Z0-9_$]+/ },
    { name: 'arrow function', re: /=>/ },
    { name: 'class', re: /\bclass\s+[a-zA-Z0-9_$]+/ },
    { name: 'template string', re: /`/ },
    { name: 'async function', re: /\basync\s+function/ },
    { name: 'await', re: /\bawait\s+/ }
  ];

  let fileHasES6 = false;
  for (const p of patterns) {
    const match = code.match(p.re);
    if (match) {
      console.error(`FAIL: ${file} contains ES6 feature: ${p.name}`);
      fileHasES6 = true;
      allValid = false;
    }
  }

  if (!fileHasES6) {
    console.log(`PASS: ${file} is pure ES5.`);
  }
}

if (allValid) {
  console.log('ALL files strictly ES5 compliant.');
} else {
  process.exit(1);
}
