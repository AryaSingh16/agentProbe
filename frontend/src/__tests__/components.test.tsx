import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../App';

// Mock fetch globally
// @ts-ignore
globalThis.fetch = vi.fn().mockImplementation((url: string) => {
  if (url.includes('/api/health')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', service: 'AgentProbe API' }),
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
            forbidden_actions: [],
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
    text: () => Promise.resolve('# Mock Report'),
  });
});

describe('AgentProbe Frontend UI', () => {
  it('renders top navigation bar with brand logo and all four tabs', () => {
    render(<App />);
    expect(screen.getByText('AgentProbe')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Run Lab')).toBeInTheDocument();
    expect(screen.getByText('Trace & Diagnosis')).toBeInTheDocument();
    expect(screen.getByText('Insights & Export')).toBeInTheDocument();
  });

  it('displays API status pill in header', () => {
    render(<App />);
    expect(screen.getByText('API:8000 (REPLAY)')).toBeInTheDocument();
  });
});
