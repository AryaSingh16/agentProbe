import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  createRun,
  fetchCassettes,
  fetchHealth,
  fetchMatrixJob,
  fetchScenarios,
  startMatrixJob,
} from '../api';
import { PolicyConfig, ScenarioSpec } from '../types';
import {
  getEvidenceLabel,
  getFaultLabel,
  getForbiddenActionLabel,
  getPolicyLabel,
  getScenarioLabel,
  getToolLabel,
} from '../lib/labels';
import { HowThisWorks } from '../components/HowThisWorks';
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

  // Policy Config overrides for Resilient agent
  const [policyConfig, setPolicyConfig] = useState<PolicyConfig>({
    max_retries: 3,
    validate_schema: true,
    treat_output_as_data: true,
    verify_postconditions: true,
  });

  const [matrixSeedCount, setMatrixSeedCount] = useState<number>(10);
  const [activeMatrixJobId, setActiveMatrixJobId] = useState<string | null>(null);
  const [includeLiveLLM, setIncludeLiveLLM] = useState<boolean>(false);
  const [confirmLiveLLMOpen, setConfirmLiveLLMOpen] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch scenarios, cassettes, & health
  const { data: scenarios, isLoading: scenariosLoading } = useQuery({
    queryKey: ['scenarios'],
    queryFn: fetchScenarios,
  });

  const { data: cassettes } = useQuery({
    queryKey: ['cassettes'],
    queryFn: fetchCassettes,
  });

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
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

  // Invalidate queries when matrix job completes or fails
  useEffect(() => {
    if (matrixStatus?.status === 'completed' || matrixStatus?.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      queryClient.invalidateQueries({ queryKey: ['recent-runs'] });
      queryClient.invalidateQueries({ queryKey: ['recent-runs-initial'] });
      queryClient.invalidateQueries({ queryKey: ['matrix-batches'] });
      queryClient.invalidateQueries({ queryKey: ['runs-list'] });
      queryClient.invalidateQueries({ queryKey: ['runs-list-for-report'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      queryClient.invalidateQueries({ queryKey: ['report-data'] });
    }
  }, [matrixStatus?.status, queryClient]);

  // Run Mutation
  const runMutation = useMutation({
    mutationFn: createRun,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      queryClient.invalidateQueries({ queryKey: ['recent-runs'] });
      queryClient.invalidateQueries({ queryKey: ['recent-runs-initial'] });
      queryClient.invalidateQueries({ queryKey: ['matrix-batches'] });
      queryClient.invalidateQueries({ queryKey: ['runs-list'] });
      queryClient.invalidateQueries({ queryKey: ['runs-list-for-report'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      queryClient.invalidateQueries({ queryKey: ['report-data'] });
      setStatusMessage(`Run completed with verdict: ${data.grader_result.verdict}`);
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
      setStatusMessage(`Matrix job scheduled across all scenarios and policies.`);
      setErrorMessage(null);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'Matrix job failed to start');
      setStatusMessage(null);
    },
  });

  const currentScenario = scenarios?.find((s) => s.scenario_id === scenarioId);

  const isRunning = runMutation.isPending || matrixMutation.isPending || (matrixStatus?.status === 'running');

  const handleRunBaseline = () => {
    if (isRunning) return;
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
    if (isRunning) return;
    setStatusMessage(`Executing faulted run (${getFaultLabel(faultType)}, intensity ${faultIntensity})...`);
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
    if (isRunning) return;
    setStatusMessage(`Triggering full test matrix with ${matrixSeedCount} seeds per cell...`);
    setErrorMessage(null);
    matrixMutation.mutate({
      scenarios: ['healthy_service', 'bad_deploy', 'rollback_denied', 'unfixable_rollback', 'injected_instruction'],
      agents: includeLiveLLM ? ['naive', 'robust', 'llm-live'] : ['naive', 'robust'],
      fault_types: ['none', 'timeout', 'http_500', 'malformed_json', 'empty_response', 'transient_then_success'],
      intensity: 2,
      seed,
      seed_count: matrixSeedCount,
      include_llm: includeLiveLLM,
    });
  };

  return (
    <div className="space-y-8">
      {/* Page Title */}
      <div className="border border-indigo-900/40 bg-gradient-to-r from-slate-900 via-indigo-950/20 to-slate-900 rounded-xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-indigo-400 text-xs tracking-wider uppercase mb-1 font-semibold">
          <Sliders className="w-4 h-4" /> Experiment Workbench
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Run Lab & Fault Orchestrator</h1>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">
          Configure controlled fault schedules against simulated ops agents. Compare baseline behaviour vs active degradation, prompt injections, and recovery failures.
        </p>
      </div>

      {/* How This Works Helper Text */}
      <HowThisWorks />

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
      {matrixStatus && (() => {
        const totalRuns = Math.max(1, matrixStatus.total_runs || 1);
        const completedRuns = Math.min(matrixStatus.completed_runs || 0, totalRuns);
        const progressPct = Math.min(100, Math.round((completedRuns / totalRuns) * 100));

        return (
          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 text-xs flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <Layers className="w-5 h-5 text-indigo-400 animate-pulse shrink-0" />
              <div className="w-full">
                <div className="font-semibold text-slate-200">
                  Evaluation Matrix: <span className="text-indigo-400">{matrixStatus.status.toUpperCase()}</span>
                </div>
                <div className="text-slate-400 mt-0.5">
                  Completed {completedRuns} of {totalRuns} runs ({progressPct}%)
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden max-w-xs">
                  <div
                    className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            </div>
            {matrixStatus.status === 'completed' && (
              <button
                onClick={() => navigate('/')}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold shrink-0"
              >
                View Updated Reliability Matrix
              </button>
            )}
          </div>
        );
      })()}

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
                </div>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">{s.description}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {s.forbidden_actions.map((f) => (
                    <span key={f} className="text-[10px] px-2 py-0.5 rounded bg-rose-950/70 border border-rose-800 text-rose-300">
                      {getForbiddenActionLabel(f)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {currentScenario && (
            <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/80 text-xs space-y-1.5">
              <div className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Expected Verification:</div>
              <div className="flex flex-wrap gap-1">
                {currentScenario.expected_evidence.map((ev) => (
                  <span key={ev} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">
                    {getEvidenceLabel(ev)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Agent Selection & Policy Customization (1 col) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-400" /> 2. Agent Policy Under Test
          </h2>

          <div className="space-y-2">
            {/* Basic agent */}
            <div
              onClick={() => setAgentType('naive')}
              className={`p-3 rounded-lg border text-left cursor-pointer transition ${
                agentType === 'naive'
                  ? 'border-amber-600 bg-amber-950/20'
                  : 'border-slate-800 bg-slate-800/40 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-amber-300">{getPolicyLabel('naive')}</span>
                <span className="text-[10px] text-slate-400">Reference policy</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Single-try deterministic policy. Lacks schema validation and retries; vulnerable to transient errors.
              </p>
            </div>

            {/* Resilient agent */}
            <div
              onClick={() => setAgentType('robust')}
              className={`p-3 rounded-lg border text-left cursor-pointer transition ${
                agentType === 'robust'
                  ? 'border-indigo-600 bg-indigo-950/20'
                  : 'border-slate-800 bg-slate-800/40 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-indigo-300">{getPolicyLabel('robust')}</span>
                <span className="text-[10px] text-slate-400">Hardened policy</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Multi-try policy with schema validation, instruction isolation, and postcondition verification.
              </p>
            </div>

            {/* Language model (live) */}
            {(() => {
              const isLiveConfigured = Boolean(health?.has_llm_key || (health?.llm_mode === 'live' && health?.has_llm_key !== false));
              return (
                <div
                  onClick={() => {
                    if (isLiveConfigured) setAgentType('llm-live');
                  }}
                  className={`p-3 rounded-lg border text-left transition ${
                    !isLiveConfigured
                      ? 'border-slate-800 bg-slate-900/40 opacity-50 cursor-not-allowed'
                      : agentType === 'llm-live'
                      ? 'border-emerald-600 bg-emerald-950/20 cursor-pointer'
                      : 'border-slate-800 bg-slate-800/40 hover:border-slate-700 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-semibold text-xs ${isLiveConfigured ? 'text-emerald-300' : 'text-slate-400'}`}>
                      Language model (live)
                    </span>
                    <span className={`text-[10px] ${isLiveConfigured ? 'text-emerald-400' : 'text-rose-400 font-medium'}`}>
                      {isLiveConfigured ? 'Live API' : 'No API key set'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    Real-time tool-calling language model against the simulated operations environment.
                  </p>
                </div>
              );
            })()}

            {/* Language model (recorded) */}
            {(() => {
              const hasRealRecordings = Boolean(cassettes?.some((c) => c.provenance === 'recorded'));
              return (
                <div
                  onClick={() => {
                    if (hasRealRecordings) setAgentType('llm-replay');
                  }}
                  className={`p-3 rounded-lg border text-left transition ${
                    !hasRealRecordings
                      ? 'border-slate-800 bg-slate-900/40 opacity-50 cursor-not-allowed'
                      : agentType === 'llm-replay' || agentType === 'llm'
                      ? 'border-purple-600 bg-purple-950/20 cursor-pointer'
                      : 'border-slate-800 bg-slate-800/40 hover:border-slate-700 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-semibold text-xs ${hasRealRecordings ? 'text-purple-300' : 'text-slate-400'}`}>
                      Language model (recorded)
                    </span>
                    <span className={`text-[10px] ${hasRealRecordings ? 'text-purple-400' : 'text-amber-400 font-medium'}`}>
                      {hasRealRecordings ? 'Recorded session' : 'No recordings yet'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    Deterministic replay of recorded language model sessions across incident scenarios.
                  </p>
                </div>
              );
            })()}
          </div>

          {/* Policy Config Options for Resilient Agent */}
          {agentType === 'robust' && (
            <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-2 text-xs">
              <div className="font-semibold text-slate-300 mb-2">Policy Configuration:</div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Max Retries on Transient Error:</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={policyConfig.max_retries}
                  onChange={(e) =>
                    setPolicyConfig({ ...policyConfig, max_retries: parseInt(e.target.value) || 0 })
                  }
                  className="w-14 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-white text-center"
                />
              </div>

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyConfig.validate_schema}
                  onChange={(e) => setPolicyConfig({ ...policyConfig, validate_schema: e.target.checked })}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                />
                <span>Validate data schemas (catch malformed payloads)</span>
              </label>

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyConfig.treat_output_as_data}
                  onChange={(e) => setPolicyConfig({ ...policyConfig, treat_output_as_data: e.target.checked })}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                />
                <span>Treat output as data (isolate prompt instructions)</span>
              </label>

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyConfig.verify_postconditions}
                  onChange={(e) => setPolicyConfig({ ...policyConfig, verify_postconditions: e.target.checked })}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                />
                <span>Verify postconditions (enforce recovery postcondition)</span>
              </label>
            </div>
          )}

          {/* Recorded Sessions Panel if LLM Replay */}
          {(agentType === 'llm-replay' || agentType === 'llm') && (
            <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-2 text-xs">
              <div className="font-semibold text-slate-300">Recorded sessions:</div>
              {!cassettes?.some((c) => c.provenance === 'recorded') && (
                <div className="text-[11px] text-slate-400 italic py-1">No recordings yet</div>
              )}
              {cassettes?.map((c) => {
                const isRealRecorded = c.provenance === 'recorded';
                const badgeLabel = isRealRecorded ? 'Recorded from a live model' : 'Scripted example';
                return (
                  <div key={c.cassette_id} className="p-2.5 rounded bg-slate-900 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">
                        {getScenarioLabel(c.scenario_id)}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                        isRealRecorded
                          ? 'bg-purple-950/70 border-purple-800 text-purple-300'
                          : 'bg-slate-800 border-slate-700 text-amber-300'
                      }`}>
                        {badgeLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{c.description}</p>
                    <details data-technical-details="true" className="text-[10px] text-slate-500 pt-1">
                      <summary className="cursor-pointer hover:text-slate-300">Technical details</summary>
                      <div className="p-2 mt-1 rounded bg-slate-950 border border-slate-800 text-slate-400 space-y-0.5 font-mono">
                        <div>Session ID: {c.cassette_id}</div>
                        <div>Provenance: {c.provenance}</div>
                        <div>Model: {c.model}</div>
                        <div>Scenario ID: {c.scenario_id}</div>
                      </div>
                    </details>
                  </div>
                );
              })}
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
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs"
              >
                <option value="none">{getFaultLabel('none')}</option>
                <option value="timeout">{getFaultLabel('timeout')}</option>
                <option value="http_500">{getFaultLabel('http_500')}</option>
                <option value="malformed_json">{getFaultLabel('malformed_json')}</option>
                <option value="empty_response">{getFaultLabel('empty_response')}</option>
                <option value="transient_then_success">{getFaultLabel('transient_then_success')}</option>
              </select>
            </div>

            {/* Intensity */}
            {faultType !== 'none' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Fault Intensity (Count of Faults):</span>
                  <span className="font-bold text-white">{faultIntensity}</span>
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
            )}

            {/* Seed */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Deterministic Random Seed:</label>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs"
              />
              <p className="text-[10px] text-slate-500">Same seed and configuration yields identical execution trace.</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pt-4 border-t border-slate-800">
            {/* Include language model in matrix toggle */}
            <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={includeLiveLLM}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setConfirmLiveLLMOpen(true);
                    } else {
                      setIncludeLiveLLM(false);
                    }
                  }}
                  className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                />
                <span className="text-xs font-semibold text-slate-200">Include language model</span>
              </label>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Include live API queries in Full Matrix evaluations (capped at 60 calls max, throttled to 4 req/min).
              </p>

              {confirmLiveLLMOpen && (
                <div className="p-2.5 rounded bg-amber-950/40 border border-amber-800 text-amber-200 space-y-2 mt-2">
                  <div className="flex items-center gap-1.5 font-semibold text-[11px] text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Confirm Live API Calls</span>
                  </div>
                  <p className="text-[10px] text-amber-300/90 leading-relaxed">
                    This will run live requests against the configured LLM API (up to 60 calls maximum).
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIncludeLiveLLM(true);
                        setConfirmLiveLLMOpen(false);
                      }}
                      className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded text-[10px]"
                    >
                      Confirm (Cap 60)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIncludeLiveLLM(false);
                        setConfirmLiveLLMOpen(false);
                      }}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

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
              <Layers className="w-4 h-4 text-purple-400" /> Run Full Matrix
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
