import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RunLab } from '../pages/RunLab';

const mockScenarios = [
  {
    scenario_id: 'bad_deploy',
    title: 'Bad Deployment Degradation',
    description: 'Test scenario description',
    expected_evidence: ['health_checked'],
    allowed_actions: ['get_health'],
    forbidden_actions: [],
  },
];

describe('Query Invalidation and Matrix Progress in RunLab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-ignore
    globalThis.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/health')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok', service: 'AgentProbe API', llm_mode: 'replay' }),
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
      if (url.includes('/api/runs') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'run-test-999',
              scenario_id: 'bad_deploy',
              agent_type: 'robust',
              grader_result: { verdict: 'PASSED', faults_encountered: 0, faults_recovered: 0, tool_calls: 3 },
              trace: [],
              metrics: { execution_time_ms: 12 },
            }),
        });
      }
      if (url.includes('/api/matrix/job_comp_123')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              job_id: 'job_comp_123',
              status: 'completed',
              total_runs: 900,
              completed_runs: 900,
              created_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
            }),
        });
      }
      if (url.includes('/api/matrix') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              job_id: 'job_comp_123',
              status: 'running',
              total_runs: 900,
              message: 'started',
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  it('invalidates metrics, recent-runs, runs-list, runs, and history when a run is created', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RunLab />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Click baseline button
    const baselineBtn = await screen.findByRole('button', { name: /Run Baseline/i });
    fireEvent.click(baselineBtn);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['metrics'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recent-runs'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['runs-list'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['runs'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['history'] });
    });
  });

  it('invalidates queries when matrix job completes and displays percentage progress bar', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RunLab />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Start matrix job
    const matrixBtn = await screen.findByRole('button', { name: /Run Full Matrix/i });
    fireEvent.click(matrixBtn);

    // Wait for the matrix job to be fetched and status 'completed' to trigger invalidation
    await waitFor(() => {
      expect(screen.getByText(/Completed 900 of 900 runs \(100%\)/i)).toBeInTheDocument();
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['metrics'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recent-runs'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['runs-list'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['runs'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['history'] });
    });
  });
});
