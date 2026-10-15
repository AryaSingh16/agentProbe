import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from '../App';

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
            total_runs: 5,
            success_rate: 0.8,
            tool_error_rate: 0.1,
            recovery_rate: 0.75,
            policy_violation_rate: 0.0,
            avg_tool_calls: 4.2,
            recovery_degradation: 0.2,
          },
          reliability_matrix: {
            naive: { timeout: 0.0 },
            robust: { timeout: 1.0 },
            llm: { timeout: 0.5 },
          },
          baseline_vs_faulted: {
            overall: {
              baseline: { passed: 4, total: 5, rate: 0.8 },
              faulted: { passed: 2, total: 5, rate: 0.4 },
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
            title: 'Bad Deployment Degradation',
            description: 'Test scenario description',
            expected_evidence: ['health_checked'],
            allowed_actions: ['get_health'],
            forbidden_actions: ['request_rollback'],
          },
        ]),
    });
  }
  if (url.includes('/api/runs')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    });
  }
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('# Mock Report Preview'),
  });
});

describe('AgentProbe Frontend UI', () => {
  it('renders top navigation bar with brand logo and all four tabs', () => {
    render(<App />);
    expect(screen.getAllByText('AgentProbe')[0]).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Run Lab')).toBeInTheDocument();
    expect(screen.getByText('Trace & Diagnosis')).toBeInTheDocument();
    expect(screen.getByText('Insights & Export')).toBeInTheDocument();
  });

  it('displays API status pill in header', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Demo mode')).toBeInTheDocument();
    });
  });
});
