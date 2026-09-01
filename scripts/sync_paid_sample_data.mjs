import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../data/samples/kyoudo-housing-paid-diagnosis.json', import.meta.url);
const output = new URL('../sample-kyoudo-data.js', import.meta.url);
const data = JSON.parse(await readFile(source, 'utf8'));
await writeFile(output, `globalThis.MADOHA_KYOUDO_SAMPLE = ${JSON.stringify(data, null, 2)};\n`, 'utf8');
