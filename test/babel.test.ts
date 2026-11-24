import { readFileGraph } from "../src/analysis/babel.js";
import { walkCodeFiles } from "../src/analysis/walk.js";


const root = '../demo';
const files = await walkCodeFiles(root);

for (const f of files) {
  const g = await readFileGraph(root, f);
  console.log('\n===', g.file, g.status);
  console.log('nodes:', g.nodes.map(n => `${n.Type} ${n.key}`));
  console.log('edges:', g.edges.map(e => `${e.type}: ${e.fromKey} -> ${e.toKey ?? e.toName}`));
  console.log('any toKey on calls/imports?',
    g.edges.some(e => e.type !== 'contains' && e.toKey));
}