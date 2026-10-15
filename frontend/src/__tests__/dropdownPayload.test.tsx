import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Overview } from '../pages/Overview';
import { RunLab } from '../pages/RunLab';
import { InsightsExport } from '../pages/InsightsExport';

const mockMetrics = {
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
    success_formatted: '41/50 (82.0%)',
    tool_error_formatted: '12/100 (12.0%)',
    recovery_formatted: '14/18 (77.8%)',
    policy_violation_formatted: '2/50 (4.0%)',
    is_low_sample: false,
  },
  reliability_matrix: {
    naive: { none: 1.0, timeout: 0.0 },
    robust: { none: 1.0, timeout: 1.0 },
    llm: { none: 1.0, timeout: 0.5 },
  },
  reliability_matrix_details: {
    naive: { none: { passed: 10, total: 10, rate: 1.0, formatted: '10/10 (100.0%)' } },
    robust: { none: { passed: 10, total: 10, rate: 1.0, formatted: '10/10 (100.0%)' } },
    llm: { none: { passed: 10, total: 10, rate: 1.0, formatted: '10/10 (100.0%)' } },
  },
  baseline_vs_faulted: {
    overall: {
      baseline: { passed: 30, total: 30, rate: 1.0, formatted: '30/30 (100.0%)' },
      faulted: { passed: 11, total: 20, rate: 0.55, formatted: '11/20 (55.0%)' },
      degradation: 0.45,
    },
    by_agent: {
      naive: {
        baseline: { passed: 10, total: 10, rate: 1.0, formatted: '10/10 (100.0%)' },
        faulted: { passed: 0, total: 10, rate: 0.0, formatted: '0/10 (0.0%)' },
        degradation: 1.0,
      },
    },
  },
  unwinnable_scenarios: ['unfixable_rollback'],
};

const mockScenarios = [
  {
    scenario_id: 'bad_deploy',
    title: 'Bad Deployment Degradation',
    description: 'Test scenario description',
    expected_evidence: ['health_checked', 'errors_checked', 'rollback_requested', 'recovery_verified'],
    allowed_actions: ['get_health', 'get_errors', 'request_rollback', 'verify_recovery'],
    forbidden_actions: [],
  },
  {
    scenario_id: 'healthy_service',
    title: 'Healthy Production Service',
    description: 'Normal operations',
    expected_evidence: ['health_checked'],
    allowed_actions: ['get_health', 'get_errors'],
    forbidden_actions: ['request_rollback'],
  },
];

let interceptedRequests: { url: string; options?: RequestInit }[] = [];

beforeEach(() => {
  interceptedRequests = [];
  // @ts-ignore
  globalThis.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    interceptedRequests.push({ url, options });

    if (url.includes('/api/health')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', service: 'AgentProbe API', llm_mode: 'replay' }),
      });
    }
    if (url.includes('/api/metrics')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockMetrics),
      });
    }
    if (url.includes('/api/scenarios')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockScenarios),
      });
    }
    if (url.includes('/api/cassettes')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    if (url.includes('/api/runs')) {
      if (options?.method === 'POST') {
        const body = options.body ? JSON.parse(options.body as string) : {};
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'run-new-123',
              scenario_id: body.scenario_id,
              agent_type: body.agent_type,
              grader_result: { verdict: 'PASSED' },
              trace: [],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes('/api/predictor/predict')) {
      const body = options?.body ? JSON.parse(options.body as string) : {};
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            failure_risk_probability: 0.5,
            risk_level: 'MEDIUM',
            contributing_factors: ['Test factor'],
            model_estimate_probability: 0.5,
            model_risk_level: 'MEDIUM',
            simulated_check_failures: 5,
            simulated_check_total: 10,
            simulated_check_rate: 0.5,
            simulated_check_formatted: '5/10 (50%)',
            disagreement: false,
            per_fault_risks: { none: 0.1, timeout: 0.5 },
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('# Mock Report Preview'),
    });
  });
});

describe('Dropdown Payload Integration Tests', () => {
  it('changing scenario dropdown in Overview requests metrics filtered by scenario_id', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Overview />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const select = await screen.findByTestId('scenario-filter');
    expect(select).toBeInTheDocument();

    // Change to bad_deploy
    fireEvent.change(select, { target: { value: 'bad_deploy' } });

    await waitFor(() => {
      const filteredCall = interceptedRequests.find(r => r.url.includes('/api/metrics?scenario_id=bad_deploy'));
      expect(filteredCall).toBeDefined();
    });
  });

  it('changing scenario and fault in RunLab changes POST /api/runs payload', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RunLab />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Wait for scenarios to load
    await screen.findByText('Healthy Production Service');

    // Click Healthy Production Service card to select it
    const healthyCard = screen.getByText('Healthy Production Service');
    fireEvent.click(healthyCard);

    // Find fault select and change to http_500
    const faultSelect = screen.getByRole('combobox');
    fireEvent.change(faultSelect, { target: { value: 'http_500' } });

    // Click "Run Faulted Experiment" button
    const runFaultedBtn = screen.getByText('Run Faulted Experiment');
    fireEvent.click(runFaultedBtn);

    await waitFor(() => {
      const runPosts = interceptedRequests.filter(
        r => r.url.includes('/api/runs') && r.options?.method === 'POST'
      );
      expect(runPosts.length).toBeGreaterThan(0);
      const lastPost = runPosts[runPosts.length - 1];
      const payload = JSON.parse(lastPost.options!.body as string);
      expect(payload.scenario_id).toBe('healthy_service');
      expect(payload.fault_type).toBe('http_500');
    });
  });

  it('changing scenario dropdown in InsightsExport sends updated scenario in predict request', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <InsightsExport />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await screen.findByText('What-if Risk Estimator');

    // Find selects in InsightsExport
    const selects = screen.getAllByRole('combobox');
    const scenarioSelect = selects[0];
    const faultSelect = selects[1];

    // Change dropdowns
    fireEvent.change(scenarioSelect, { target: { value: 'healthy_service' } });
    fireEvent.change(faultSelect, { target: { value: 'http_500' } });

    await waitFor(() => {
      const predictCalls = interceptedRequests.filter(
        r => r.url.includes('/api/predictor/predict') && r.options?.method === 'POST'
      );
      expect(predictCalls.length).toBeGreaterThan(0);
      const lastCall = predictCalls[predictCalls.length - 1];
      const payload = JSON.parse(lastCall.options!.body as string);
      expect(payload.scenario_id).toBe('healthy_service');
      expect(payload.fault_type).toBe('http_500');
    });
  });
});
