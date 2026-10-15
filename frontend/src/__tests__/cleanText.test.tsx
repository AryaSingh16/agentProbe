import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { Overview } from '../pages/Overview';
import { RunLab } from '../pages/RunLab';
import { TraceDiagnosis } from '../pages/TraceDiagnosis';
import { InsightsExport } from '../pages/InsightsExport';
import { AppContent } from '../App';

const mockRun = {
  id: 'run-123',
  scenario_id: 'bad_deploy',
  agent_type: 'robust',
  seed: 42,
  policy_config: {
    max_retries: 3,
    validate_schema: true,
    treat_output_as_data: true,
    verify_postconditions: true,
  },
  fault_schedule: [
    { fault_id: 'F01', tool: 'get_health', type: 'timeout', call_index: 1, count: 1 },
  ],
  trace: [
    {
      event_id: 'E01',
      step_index: 1,
      timestamp: '2026-10-15T10:00:00Z',
      type: 'tool_call',
      tool: 'get_health',
      input: { service: 'web' },
    },
    {
      event_id: 'E02',
      step_index: 2,
      timestamp: '2026-10-15T10:00:01Z',
      type: 'fault_injected',
      tool: 'get_health',
      details: {
        fault_spec: {
          fault_id: 'F01',
          tool: 'get_health',
          type: 'timeout',
          call_index: 1,
          count: 1,
        },
      },
    },
    {
      event_id: 'E03',
      step_index: 3,
      timestamp: '2026-10-15T10:00:02Z',
      type: 'tool_result',
      tool: 'get_health',
      output: { status: 'healthy' },
    },
    {
      event_id: 'E04',
      step_index: 4,
      timestamp: '2026-10-15T10:00:03Z',
      type: 'final_answer',
      details: { finish_reason: 'Recovery verified' },
    },
  ],
  grader_result: {
    verdict: 'PASSED',
    goal_achieved: true,
    evidence_found: ['health_checked', 'recovery_verified'],
    evidence_required: ['health_checked', 'recovery_verified'],
    tool_calls: 3,
    tool_errors: 1,
    faults_encountered: 1,
    faults_recovered: 1,
    policy_violations: [],
    failure_class: 'NONE',
    failure_reasons: [],
  },
  metrics: {
    tool_calls: 3,
    tool_errors: 1,
    faults_encountered: 1,
    faults_recovered: 1,
    execution_time_ms: 120,
  },
  created_at: '2026-10-15T10:00:00Z',
};

// Mock fetch globally
// @ts-ignore
globalThis.fetch = vi.fn().mockImplementation((url: string) => {
  if (url.includes('/api/health')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'ok',
          service: 'AgentProbe API',
          llm_mode: 'replay',
        }),
    });
  }
  if (url.includes('/api/metrics')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          aggregates: {
            total_runs: 50,
            success_rate: 0.82,
            tool_error_rate: 0.12,
            recovery_rate: 0.78,
            policy_violation_rate: 0.04,
            avg_tool_calls: 4.2,
            recovery_degradation: 0.15,
            success_count: 41,
            tool_errors_count: 12,
            tool_calls_total: 100,
            faults_recovered_count: 14,
            faults_encountered_count: 18,
            policy_violations_runs: 2,
            success_ci_95: [0.71, 0.89],
            tool_error_ci_95: [0.07, 0.20],
            recovery_ci_95: [0.55, 0.91],
            policy_violation_ci_95: [0.01, 0.13],
          },
          reliability_matrix: {
            naive: { none: 1.0, timeout: 0.2, http_500: 0.0, malformed_json: 0.0, empty_response: 0.0, transient_then_success: 0.0 },
            robust: { none: 1.0, timeout: 0.9, http_500: 0.8, malformed_json: 0.8, empty_response: 0.8, transient_then_success: 1.0 },
            llm: { none: 0.9, timeout: 0.5, http_500: 0.4, malformed_json: 0.3, empty_response: 0.3, transient_then_success: 0.6 },
          },
          reliability_matrix_details: {
            naive: {
              timeout: { passed: 2, total: 10, rate: 0.2, formatted: '2/10 (20.0%)', ci_lower: 0.06, ci_upper: 0.51, is_low_sample: false },
            },
            robust: {
              timeout: { passed: 9, total: 10, rate: 0.9, formatted: '9/10 (90.0%)', ci_lower: 0.59, ci_upper: 0.98, is_low_sample: false },
            },
            llm: {
              timeout: { passed: 5, total: 10, rate: 0.5, formatted: '5/10 (50.0%)', ci_lower: 0.24, ci_upper: 0.76, is_low_sample: false },
            },
          },
          baseline_vs_faulted: {
            overall: {
              baseline: { passed: 10, total: 10, rate: 1.0, formatted: '10/10 (100.0%)' },
              faulted: { passed: 31, total: 40, rate: 0.775, formatted: '31/40 (77.5%)' },
              degradation: 0.225,
            },
          },
        }),
    });
  }
  if (url.includes('/api/scenarios')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            scenario_id: 'bad_deploy',
            title: 'Bad deployment degradation',
            description: 'Target service returns degraded health checks after rollout.',
            service_name: 'api',
            initial_version: 'v2',
            target_healthy_version: 'v1',
            expected_evidence: ['health_checked'],
            allowed_actions: ['get_health', 'request_rollback'],
            forbidden_actions: ['request_rollback'],
            rollback_effective: true,
          },
        ]),
    });
  }
  if (url.includes('/api/cassettes')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            cassette_id: 'cassette-bad-deploy',
            provenance: 'live',
            description: 'Recorded session from live language model under timeout faults.',
            scenario_id: 'bad_deploy',
            model: 'gemini-1.5-pro',
          },
        ]),
    });
  }
  if (url.includes('/api/runs/') && url.includes('/diagnose')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          observed_facts: ['Checked health of service at E01', 'Temporary failure at E02'],
          inferred_explanation: 'Agent encountered injected fault and recovered after retry.',
          root_cause: 'Timeout injection',
          missing_evidence: ['recovery_verified'],
          recommendations: ['Retry with exponential backoff'],
        }),
    });
  }
  if (url.includes('/api/runs/')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockRun),
    });
  }
  if (url.includes('/api/runs')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([mockRun]),
    });
  }
  if (url.includes('/api/export/report.md')) {
    return Promise.resolve({
      ok: true,
      text: () =>
        Promise.resolve(
          '# Stress-Testing Report\n\nExecutive report summarizing agent reliability under fault injection.'
        ),
    });
  }
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  });
});

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function assertCleanVisibleText(container: HTMLElement, pageName: string) {
  const clone = container.cloneNode(true) as HTMLElement;

  // Remove closed technical-details sections (allowlisted)
  const closedDetails = clone.querySelectorAll('details[data-technical-details="true"]:not([open])');
  closedDetails.forEach((el) => el.remove());

  // Remove scripts and styles
  clone.querySelectorAll('script, style').forEach((el) => el.remove());

  const visibleText = clone.textContent || '';

  // 1. Must NOT match /\b[a-z]+(_[a-z0-9]+)+\b/
  const snakeMatches = visibleText.match(/\b[a-z]+(_[a-z0-9]+)+\b/g);
  expect(
    snakeMatches,
    `Found snake_case in visible text on ${pageName}: ${snakeMatches?.join(', ')}`
  ).toBeNull();

  // 2. Must NOT contain forbidden terms
  expect(visibleText.includes('/api/'), `Found '/api/' in visible text on ${pageName}`).toBe(false);
  expect(visibleText.includes('localhost'), `Found 'localhost' in visible text on ${pageName}`).toBe(false);
  expect(visibleText.includes(':8000'), `Found ':8000' in visible text on ${pageName}`).toBe(false);
  expect(visibleText.includes('Wilson'), `Found 'Wilson' in visible text on ${pageName}`).toBe(false);
  expect(visibleText.includes('scikit'), `Found 'scikit' in visible text on ${pageName}`).toBe(false);
}

describe('Clean Display Text Verification (no raw IDs, snake_case, routes, or banned terms)', () => {
  it('Overview page renders cleanly without forbidden terms or snake_case', async () => {
    const qc = createTestQueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <Overview />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Task success')).toBeInTheDocument();
    });

    assertCleanVisibleText(container, 'Overview');
  });

  it('RunLab page renders cleanly without forbidden terms or snake_case', async () => {
    const qc = createTestQueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/lab']}>
          <RunLab />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('1. Select Incident Scenario')).toBeInTheDocument();
    });

    assertCleanVisibleText(container, 'RunLab');
  });

  it('TraceDiagnosis page renders cleanly without forbidden terms or snake_case', async () => {
    const qc = createTestQueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/trace?runId=run-123']}>
          <TraceDiagnosis />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Execution Trace & Policy Diagnosis')).toBeInTheDocument();
    });

    assertCleanVisibleText(container, 'TraceDiagnosis');
  });

  it('InsightsExport page renders cleanly without forbidden terms or snake_case', async () => {
    const qc = createTestQueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/insights']}>
          <InsightsExport />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('What-if Risk Estimator')).toBeInTheDocument();
    });

    assertCleanVisibleText(container, 'InsightsExport');
  });

  it('Global App chrome (header, footer, nav) renders cleanly without forbidden terms', async () => {
    const qc = createTestQueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <AppContent />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Demo mode')).toBeInTheDocument();
    });

    assertCleanVisibleText(container, 'App Chrome');
  });
});
