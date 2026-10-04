import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { TIMEFRAMES, aggregateCandles, fisherState, calculateFisher } from '../research.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
const assets = ['index.html', 'app.js', 'research.mjs', 'data', 'lib'];

// Copy the viewer and its public data, keeping repository metadata out of the site.
await mkdir(output, { recursive: true });
for (const asset of assets) {
  await cp(join(root, asset), join(output, asset), { recursive: true });
}

const html = await readFile(join(output, 'index.html'), 'utf8');
for (const [, source] of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
  if (!/^(https?:)?\/\//.test(source)) await stat(join(output, source));
}

const indexSource = await readFile(join(output, 'data/index.js'), 'utf8');
const months = [...indexSource.matchAll(/"month":"(\d{4}-\d{2})"/g)].map((match) => match[1]).sort();
if (!months.length) throw new Error('No monthly data found in data/index.js');
const states = new Map(TIMEFRAMES.map((timeframe) => [timeframe, fisherState(9)]));
let totalCandles = 0;
for (const month of months) {
  for (const prefix of ['f_', 'c_']) await stat(join(output, 'data', `${prefix}${month}.js`));
  const context = { window: { __data: {} } };
  runInNewContext(await readFile(join(root, 'data', `c_${month}.js`), 'utf8'), context, { filename: `c_${month}.js` });
  const candles = context.window.__data[`c_${month}`];
  totalCandles += candles.length;
  const series = {};
  for (const timeframe of TIMEFRAMES) {
    const bars = aggregateCandles(candles, timeframe);
    series[timeframe] = calculateFisher(bars, states.get(timeframe)).map(([time, fisher, trigger]) =>
      [time, Number(fisher.toFixed(8)), Number(trigger.toFixed(8))]);
  }
  await writeFile(join(output, 'data', `fisher_${month}.json`), JSON.stringify({ length: 9, source: 'HL2', signal: 'previous_bar', series }));
}

let files = 0;
let bytes = 0;
async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await checkDirectory(path);
    else {
      const info = await stat(path);
      if (info.size > 25 * 1024 * 1024) throw new Error(`Cloudflare Pages file limit exceeded: ${path}`);
      files++;
      bytes += info.size;
    }
  }
}
await checkDirectory(output);
console.log(`Built dist: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB, ${months.length} months; Fisher9 on ${totalCandles} candles, ${TIMEFRAMES.length} timeframes.`);
