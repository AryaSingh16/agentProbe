import {
  AggregateMetrics,
  CassetteMetadata,
  Diagnosis,
  HardeningResult,
  MatrixJobStatusResponse,
  MinimalFaultSet,
  PolicyConfig,
  PredictorPredictResponse,
  PredictorTrainResponse,
  RunResponse,
  ScenarioSpec,
} from './types';

const API_BASE = '/api';

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Failed to fetch health status');
  return res.json();
}

export async function fetchScenarios(): Promise<ScenarioSpec[]> {
  const res = await fetch(`${API_BASE}/scenarios`);
  if (!res.ok) throw new Error('Failed to fetch scenarios');
  return res.json();
}

export async function fetchCassettes(): Promise<CassetteMetadata[]> {
  const res = await fetch(`${API_BASE}/cassettes`);
  if (!res.ok) throw new Error('Failed to fetch cassettes');
  return res.json();
}

export async function fetchRuns(limit = 100, offset = 0): Promise<RunResponse[]> {
  const res = await fetch(`${API_BASE}/runs?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error('Failed to fetch runs');
  return res.json();
}

export async function fetchRun(runId: string): Promise<RunResponse> {
  const res = await fetch(`${API_BASE}/runs/${runId}`);
  if (!res.ok) throw new Error(`Run ${runId} not found`);
  return res.json();
}

export async function createRun(payload: {
  scenario_id: string;
  agent_type: string;
  policy_config?: PolicyConfig;
  fault_type?: string | null;
  fault_intensity?: number;
  seed?: number;
}): Promise<RunResponse> {
  const res = await fetch(`${API_BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to create run' }));
    throw new Error(err.detail || 'Failed to create run');
  }
  return res.json();
}

export async function fetchMetrics(): Promise<{
  aggregates: AggregateMetrics;
  reliability_matrix: Record<string, Record<string, number | null>>;
  reliability_matrix_details?: Record<string, Record<string, any>>;
}> {
  const res = await fetch(`${API_BASE}/metrics`);
  if (!res.ok) throw new Error('Failed to fetch metrics');
  return res.json();
}

export async function startMatrixJob(payload: {
  scenarios: string[];
  agents: string[];
  fault_types: string[];
  intensity: number;
  seed: number;
  seed_count?: number;
}): Promise<{ job_id: string; total_runs: number; message: string }> {
  const res = await fetch(`${API_BASE}/matrix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to start matrix job');
  return res.json();
}

export async function fetchMatrixJob(jobId: string): Promise<MatrixJobStatusResponse> {
  const res = await fetch(`${API_BASE}/matrix/${jobId}`);
  if (!res.ok) throw new Error(`Matrix job ${jobId} not found`);
  return res.json();
}

export async function shrinkRun(runId: string, maxReruns = 20): Promise<MinimalFaultSet> {
  const res = await fetch(`${API_BASE}/shrink/${runId}?max_reruns=${maxReruns}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to shrink run' }));
    throw new Error(err.detail || 'Failed to shrink run');
  }
  return res.json();
}

export async function hardenRun(runId: string): Promise<HardeningResult> {
  const res = await fetch(`${API_BASE}/harden/${runId}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to harden run' }));
    throw new Error(err.detail || 'Failed to harden run');
  }
  return res.json();
}

export async function diagnoseRun(runId: string): Promise<Diagnosis> {
  const res = await fetch(`${API_BASE}/diagnose/${runId}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to diagnose run');
  return res.json();
}

export async function trainPredictor(): Promise<PredictorTrainResponse> {
  const res = await fetch(`${API_BASE}/predictor/train`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to train predictor');
  return res.json();
}

export async function predictRisk(payload: {
  scenario_id: string;
  policy: PolicyConfig;
  fault_type?: string | null;
  fault_intensity: number;
}): Promise<PredictorPredictResponse> {
  const res = await fetch(`${API_BASE}/predictor/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to predict risk');
  return res.json();
}

export async function clearHistory(): Promise<void> {
  const res = await fetch(`${API_BASE}/history?confirm=true`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear run history');
}

export async function generateSimulatorRuns(count = 50): Promise<{
  status: string;
  generated_count: number;
  total_runs_in_db: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/simulator/generate?count=${count}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to generate simulator runs');
  return res.json();
}
