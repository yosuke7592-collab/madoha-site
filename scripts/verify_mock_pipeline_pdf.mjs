import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FixturePaidAdapter, MemoryMeasurementStore, PAID_CHANNELS, measurementsToPaidReport, runPaidMeasurements } from '../measurement/paid-pipeline.mjs';

const root = resolve(import.meta.dirname, '..');
const base = JSON.parse(await readFile(resolve(root, 'data/samples/kyoudo-housing-paid-diagnosis.json'), 'utf8'));
const entity = { id: 'kyoudo', name: base.subject.name, official_url: base.subject.url };
const questions = base.queries.map((query, index) => ({ id: query.id, order: index + 1, query: query.query, intent: query.intent, kind: query.kind, selection_reason: query.selectionReason || '確定済みの質問選定理由', source_signals: query.sourceSignals || ['fixture'] }));
const fixture = input => ({ raw_answer: `1. ${input.entity.name} — 地域で相談できる会社です。\n2. 比較対象株式会社`, sources: [{ url: entity.official_url, title: `${entity.name} 公式サイト`, evidence: 'citation' }], usage: { mock: true }, raw_response_ref: `mock-${input.question_id}-${input.channel}` });
const adapters = Object.fromEntries(PAID_CHANNELS.map(channel => [channel, new FixturePaidAdapter({ channel, registry: [entity], fixtures: fixture })]));
const result = await runPaidMeasurements({ diagnosis: { id: 'pdf-mock', run_id: 'pdf-mock-run', entity, locale: 'ja-JP', location: base.subject.area }, questions, adapters, store: new MemoryMeasurementStore(), maxCost: 1 });
if (result.status !== 'complete' || result.measurements.length !== 30) throw new Error('Mock pipeline did not produce 30 measurements.');
const report = measurementsToPaidReport(base, result.measurements);
report.sample = true;
const output = resolve(process.argv[2] || resolve(root, 'tmp/mock-pipeline-report.json'));
await writeFile(output, JSON.stringify(report, null, 2));
console.log(output);
