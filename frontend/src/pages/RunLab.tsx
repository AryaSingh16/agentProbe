import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  createRun,
  fetchCassettes,
  fetchMatrixJob,
  fetchScenarios,
  startMatrixJob,
} from '../api';
import { PolicyConfig, ScenarioSpec } from '../types';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cpu,
  FileCheck,
  Flame,
  HelpCircle,
  Layers,
  Play,
  RotateCcw,
  Shield,
  Sliders,
  Sparkles,
} from 'lucide-react';

export const RunLab: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Form State
  const [scenarioId, setScenarioId] = useState<string>('bad_deploy');
  const [agentType, setAgentType] = useState<string>('robust');
  const [faultType, setFaultType] = useState<string>('timeout');
  const [faultIntensity, setFaultIntensity] = useState<number>(2);
  const [seed, setSeed] = useState<number>(42);

  // Policy Config overrides for Robust agent
  const [policyConfig, setPolicyConfig] = useState<PolicyConfig>({
    max_retries: 3,
    validate_schema: true,
    treat_output_as_data: true,
    verify_postconditions: true,
  });

  const [activeMatrixJobId, setActiveMatrixJobId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch scenarios & cassettes
  const { data: scenarios, isLoading: scenariosLoading } = useQuery({
    queryKey: ['scenarios'],
    queryFn: fetchScenarios,
  });

  const { data: cassettes } = useQuery({
    queryKey: ['cassettes'],
    queryFn: fetchCassettes,
  });

  // Matrix status query
  const { data: matrixStatus } = useQuery({
    queryKey: ['matrix-job', activeMatrixJobId],
    queryFn: () => (activeMatrixJobId ? fetchMatrixJob(activeMatrixJobId) : null),
    enabled: !!activeMatrixJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'failed' ? false : 1000;
    },
  });

  // Run Mutation
  const runMutation = useMutation({
    mutationFn: createRun,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recent-runs'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      setStatusMessage(`Run ${data.id} completed with verdict: ${data.grader_result.verdict}`);
      setErrorMessage(null);
      // Navigate to trace view
      navigate(`/trace?runId=${data.id}`);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Execution failed');
      setStatusMessage(null);
    },
  });

  // Matrix Mutation
  const matrixMutation = useMutation({
    mutationFn: startMatrixJob,
    onSuccess: (data) => {
      setActiveMatrixJobId(data.job_id);
      setStatusMessage(`Matrix job ${data.job_id} scheduled across all scenarios and policies.`);
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Matrix job scheduling failed');
    },
  });

  const currentScenario = scenarios?.find((s) => s.scenario_id === scenarioId);

  const handleRunBaseline = () => {
    setStatusMessage('Executing baseline run (0 faults)...');
    setErrorMessage(null);
    runMutation.mutate({
      scenario_id: scenarioId,
      agent_type: agentType,
      policy_config: agentType === 'robust' ? policyConfig : undefined,
      fault_type: null,
      fault_intensity: 0,
      seed,
    });
  };

  const handleRunFaulted = () => {
    setStatusMessage(`Executing faulted run (${faultType}, intensity ${faultIntensity})...`);
    setErrorMessage(null);
    runMutation.mutate({
      scenario_id: scenarioId,
      agent_type: agentType,
      policy_config: agentType === 'robust' ? policyConfig : undefined,
      fault_type: faultType === 'none' ? null : faultType,
      fault_intensity: faultType === 'none' ? 0 : faultIntensity,
      seed,
    });
  };

  const handleRunMatrix = () => {
    setStatusMessage('Triggering full test matrix...');
    setErrorMessage(null);
    matrixMutation.mutate({
      scenarios: ['healthy_service', 'bad_deploy', 'rollback_denied', 'unfixable_rollback', 'injected_instruction'],
      agents: ['naive', 'robust'],
      fault_types: ['none', 'timeout', 'http_500', 'malformed_json', 'transient_then_success'],
      intensity: 2,
      seed,
    });
  };

  const isRunning = runMutation.isPending || matrixMutation.isPending || (matrixStatus?.status === 'running');

  return (
    <div className="space-y-8">
      {/* Page Title */}
      <div className="border border-indigo-900/40 bg-gradient-to-r from-slate-900 via-indigo-950/20 to-slate-900 rounded-xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-indigo-400 font-mono text-xs tracking-wider uppercase mb-1">
          <Sliders className="w-4 h-4" /> Experiment Workbench
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Run Lab & Fault Orchestrator</h1>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">
          Configure controlled fault schedules against simulated ops agents. Compare baseline behaviour vs active degradation, prompt injections, and recovery failures.
        </p>
      </div>

      {/* Status & Error Alerts */}
      {statusMessage && (
        <div className="p-4 rounded-lg bg-indigo-950/40 border border-indigo-800 text-indigo-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Matrix Job Progress Banner */}
      {matrixStatus && (
        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 text-xs flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Layers className="w-5 h-5 text-indigo-400 animate-pulse" />
            <div>
              <div className="font-semibold text-slate-200">
                Matrix Job: <span className="font-mono text-indigo-400">{matrixStatus.job_id}</span> ({matrixStatus.status.toUpperCase()})
              </div>
              <div className="text-slate-400">
                Executed {matrixStatus.completed_runs} / {matrixStatus.total_runs} combinations across scenarios & policies.
              </div>
            </div>
          </div>
          {matrixStatus.status === 'completed' && (
            <button
              onClick={() => navigate('/')}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium"
            >
              View Updated Matrix Heatmap
            </button>
          )}
        </div>
      )}

      {/* Config Form Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Scenario Selection (1 col) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" /> 1. Select Incident Scenario
          </h2>

          <div className="space-y-2">
            {scenarios?.map((s) => (
              <div
                key={s.scenario_id}
                onClick={() => setScenarioId(s.scenario_id)}
                className={`p-3 rounded-lg border text-left cursor-pointer transition ${
                  scenarioId === s.scenario_id
                    ? 'border-indigo-600 bg-indigo-950/30'
                    : 'border-slate-800 bg-slate-800/40 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-white">{s.title}</span>
                  <span className="text-[10px] font-mono text-indigo-400">{s.scenario_id}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{s.description}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {s.forbidden_actions.map((f) => (
                    <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-rose-950/70 border border-rose-800 text-rose-300">
                      Forbidden: {f}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {currentScenario && (
            <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/80 text-[11px] space-y-1">
              <div className="text-slate-400 font-semibold uppercase text-[10px]">Expected Evidence:</div>
              <div className="flex flex-wrap gap-1">
                {currentScenario.expected_evidence.map((ev) => (
                  <span key={ev} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
                    {ev}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Agent & Policy Selection (1 col) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Bot className="w-4 h-4 text-indigo-400" /> 2. Agent Policy & Guardrails
            </h2>
          </div>

          <div className="p-2.5 rounded bg-amber-950/20 border border-amber-900/40 text-[11px] text-amber-300/90">
            <strong>Agent Mode Note:</strong> Naive and Robust agents are <em>deterministic simulated agents</em> running with fixed policy guardrails.
          </div>

          <div className="space-y-2">
            {[
              { id: 'naive', title: 'Naive Agent', desc: 'No retries, trusts tool outputs, vulnerable to injections & malformed schemas.' },
              { id: 'robust', title: 'Robust Agent', desc: 'Configurable policy with retry budget, schema validation, and recovery verification.' },
              { id: 'llm-replay', title: 'LLM Replay (Cassette)', desc: 'Replays offline hand-authored / recorded execution trajectories without live model.' },
              { id: 'llm-live', title: 'LLM Live (Ollama / OpenAI)', desc: 'Queries live OpenAI-compatible endpoint. Requires running server or profile llm.' },
            ].map((ag) => (
              <div
                key={ag.id}
                onClick={() => setAgentType(ag.id)}
                className={`p-3 rounded-lg border cursor-pointer transition ${
                  agentType === ag.id
                    ? 'border-indigo-600 bg-indigo-950/30'
                    : 'border-slate-800 bg-slate-800/40 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold text-xs text-white">{ag.title}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{ag.desc}</div>
              </div>
            ))}
          </div>

          {/* Policy Config Checkboxes for Robust */}
          {agentType === 'robust' && (
            <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-2.5">
              <div className="text-xs font-semibold text-slate-300">PolicyConfig Parameters</div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Max Retries Budget:</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={policyConfig.max_retries}
                  onChange={(e) => setPolicyConfig({ ...policyConfig, max_retries: parseInt(e.target.value) || 0 })}
                  className="w-16 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-center text-white text-xs font-mono"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyConfig.validate_schema}
                  onChange={(e) => setPolicyConfig({ ...policyConfig, validate_schema: e.target.checked })}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                />
                <span>Validate JSON Schema (catch malformed payloads)</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyConfig.treat_output_as_data}
                  onChange={(e) => setPolicyConfig({ ...policyConfig, treat_output_as_data: e.target.checked })}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                />
                <span>Treat Output as Data (isolate prompt injections)</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyConfig.verify_postconditions}
                  onChange={(e) => setPolicyConfig({ ...policyConfig, verify_postconditions: e.target.checked })}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                />
                <span>Verify Postconditions (enforce verify_recovery)</span>
              </label>
            </div>
          )}

          {/* Cassette detail if LLM Replay */}
          {agentType === 'llm-replay' && (
            <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-2 text-xs">
              <div className="font-semibold text-slate-300">Available Replay Cassettes:</div>
              {cassettes?.map((c) => (
                <div key={c.cassette_id} className="p-2 rounded bg-slate-900 border border-slate-800 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-indigo-400">{c.cassette_id}</span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] uppercase text-amber-400 font-bold">
                      {c.provenance}
                    </span>
                  </div>
                  <div className="text-slate-400 mt-1">{c.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fault Injection Setup & Actions (1 col) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Flame className="w-4 h-4 text-rose-400" /> 3. Fault Injection Schedule
            </h2>

            {/* Fault Type */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Fault Type:</label>
              <select
                value={faultType}
                onChange={(e) => setFaultType(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs font-mono"
              >
                <option value="none">None (Clean Run)</option>
                <option value="timeout">Timeout (HTTP 408 / 5000ms)</option>
                <option value="http_500">HTTP 500 (Internal Error)</option>
                <option value="malformed_json">Malformed JSON (Corrupted string)</option>
                <option value="empty_response">Empty Response (&quot;&quot;)</option>
                <option value="transient_then_success">Transient Then Success (fails 2x then OK)</option>
              </select>
            </div>

            {/* Intensity */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Fault Intensity (Count of Faults):</span>
                <span className="font-mono font-bold text-white">{faultIntensity}</span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                value={faultIntensity}
                onChange={(e) => setFaultIntensity(parseInt(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </div>

            {/* Seed */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Deterministic Random Seed:</label>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs font-mono"
              />
              <p className="text-[10px] text-slate-500">Same seed + config yields identical execution trace.</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-4 border-t border-slate-800">
            <button
              onClick={handleRunBaseline}
              disabled={isRunning}
              className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition"
            >
              <FileCheck className="w-4 h-4 text-emerald-400" /> Run Baseline (0 Faults)
            </button>

            <button
              onClick={handleRunFaulted}
              disabled={isRunning}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition shadow-lg shadow-indigo-600/20"
            >
              <Play className="w-4 h-4" /> Run Faulted Experiment
            </button>

            <button
              onClick={handleRunMatrix}
              disabled={isRunning}
              className="w-full py-2.5 px-4 bg-purple-900/60 hover:bg-purple-800/80 border border-purple-700/60 disabled:opacity-50 text-purple-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition"
            >
              <Layers className="w-4 h-4 text-purple-400" /> Run Full Matrix (Async Job)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
