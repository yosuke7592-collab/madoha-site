const STATUSES = new Set(['success', 'partial', 'failed']);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function isTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function validateRawProviderEnvelope(value) {
  assert(value && typeof value === 'object', 'RawProviderEnvelope must be an object.');
  assert(value.schemaVersion === '1.0', 'RawProviderEnvelope.schemaVersion must be "1.0".');
  assert(typeof value.id === 'string' && value.id, 'RawProviderEnvelope.id is required.');
  assert(typeof value.provider === 'string' && value.provider, 'RawProviderEnvelope.provider is required.');
  assert(isTimestamp(value.receivedAt), 'RawProviderEnvelope.receivedAt must be an ISO timestamp.');
  assert(value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload), 'RawProviderEnvelope.payload must be an object.');
  return value;
}
export function validateMeasurementRecord(value) {
  assert(value && typeof value === 'object', 'MeasurementRecord must be an object.');
  assert(value.schemaVersion === '1.0', 'MeasurementRecord.schemaVersion must be "1.0".');
  for (const field of ['id', 'runId', 'marketId', 'queryId', 'queryText', 'queryIntent', 'queryStyle', 'provider', 'model']) {
    assert(typeof value[field] === 'string' && value[field], `MeasurementRecord.${field} is required.`);
  }
  assert(Number.isInteger(value.repetition) && value.repetition > 0, 'MeasurementRecord.repetition must be a positive integer.');
  assert(isTimestamp(value.requestedAt), 'MeasurementRecord.requestedAt must be an ISO timestamp.');
  assert(isTimestamp(value.measuredAt), 'MeasurementRecord.measuredAt must be an ISO timestamp.');
  assert(STATUSES.has(value.status), 'MeasurementRecord.status must be success, partial, or failed.');
  assert(Array.isArray(value.companies), 'MeasurementRecord.companies must be an array.');
  assert(Array.isArray(value.citations), 'MeasurementRecord.citations must be an array.');
  if (value.status === 'failed') {
    assert(value.answerText === '', 'Failed MeasurementRecord.answerText must be empty.');
    assert(value.companies.length === 0, 'Failed MeasurementRecord.companies must be empty.');
    assert(value.citations.length === 0, 'Failed MeasurementRecord.citations must be empty.');
    assert(value.failure && typeof value.failure === 'object', 'Failed MeasurementRecord.failure is required.');
  } else {
    assert(typeof value.answerText === 'string', 'MeasurementRecord.answerText must be a string.');
    assert(value.failure === null, 'Successful or partial MeasurementRecord.failure must be null.');
  }
  return value;
}
