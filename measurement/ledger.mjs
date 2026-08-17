import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const EMPTY = now => ({
  date: now.slice(0, 10), month: now.slice(0, 7), runsToday: 0,
  estimatedSpentTodayUsd: 0, reportedSpentTodayUsd: 0,
  estimatedSpentMonthUsd: 0, reportedSpentMonthUsd: 0, runs: []
});

export function createRunFingerprint({ marketId, provider, model, querySetVersion, repetitions, cycleId }) {
  const source = JSON.stringify({ marketId, provider, model, querySetVersion, repetitions, cycleId });
  return createHash('sha256').update(source).digest('hex');
}

export function normalizeLedger(value, now) {
  const ledger = value && typeof value === 'object' ? structuredClone(value) : EMPTY(now);
  ledger.runs = Array.isArray(ledger.runs) ? ledger.runs : [];
  if (ledger.month !== now.slice(0, 7)) return EMPTY(now);
  if (ledger.date !== now.slice(0, 10)) {
    ledger.date = now.slice(0, 10);
    ledger.runsToday = 0;
    ledger.estimatedSpentTodayUsd = 0;
    ledger.reportedSpentTodayUsd = 0;
  }
  return ledger;
}

export function assertNoDuplicate(ledger, fingerprint, now, windowMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.parse(now) - windowMs;
  const duplicate = ledger.runs.some(run =>
    run.fingerprint === fingerprint && ['completed', 'partial'].includes(run.status) && Date.parse(run.completedAt || run.startedAt) >= cutoff
  );
  if (duplicate) throw new Error('Duplicate live measurement run blocked for this measurement cycle.');
}

export function ledgerUsage(ledger) {
  return {
    runsToday: Number(ledger.runsToday) || 0,
    dailyUsd: Math.max(Number(ledger.estimatedSpentTodayUsd) || 0, Number(ledger.reportedSpentTodayUsd) || 0),
    monthlyUsd: Math.max(Number(ledger.estimatedSpentMonthUsd) || 0, Number(ledger.reportedSpentMonthUsd) || 0)
  };
}

export function recordCompletedRun(ledger, run) {
  const estimated = Number(run.estimatedCostUsd) || 0;
  const reported = Number(run.reportedCostUsd) || 0;
  const addUsd = (current, amount) => Number(((Number(current) || 0) + amount).toFixed(6));
  ledger.runsToday += 1;
  ledger.estimatedSpentTodayUsd = addUsd(ledger.estimatedSpentTodayUsd, estimated);
  ledger.reportedSpentTodayUsd = addUsd(ledger.reportedSpentTodayUsd, reported);
  ledger.estimatedSpentMonthUsd = addUsd(ledger.estimatedSpentMonthUsd, estimated);
  ledger.reportedSpentMonthUsd = addUsd(ledger.reportedSpentMonthUsd, reported);
  ledger.runs.push(structuredClone(run));
  return ledger;
}

export class FileLedgerStore {
  constructor(path) { this.path = path; }
  async load(now) {
    try { return normalizeLedger(JSON.parse(await readFile(this.path, 'utf8')), now); }
    catch (error) { if (error.code === 'ENOENT') return EMPTY(now); throw error; }
  }
  async save(ledger) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(ledger, null, 2));
  }
}

export class MemoryLedgerStore {
  constructor(initial = null) { this.value = initial; }
  async load(now) { return normalizeLedger(this.value, now); }
  async save(ledger) { this.value = structuredClone(ledger); }
}
