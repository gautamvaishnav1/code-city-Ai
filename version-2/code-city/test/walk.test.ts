import { walkCodeFiles } from "../src/analysis/walk.js";

const files =await walkCodeFiles('../../code-city')
console.log('count:', files.length);
console.log('first 5:', files.slice(0, 100));

// checks
console.log('has node_modules?', files.some(f => f.includes('node_modules')));
console.log('has .d.ts?', files.some(f => f.endsWith('.d.ts')));
console.log('all code files?', files.every(f => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f)));

// determinism
const again = await walkCodeFiles('./src');
console.log('same order?', JSON.stringify(files) === JSON.stringify(again));