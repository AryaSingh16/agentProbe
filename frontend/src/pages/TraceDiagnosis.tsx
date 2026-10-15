import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  diagnoseRun,
  fetchRun,
  fetchRuns,
  hardenRun,
  shrinkRun,
} from '../api';
import {
  Diagnosis,
  HardeningResult,
  MinimalFaultSet,
  RunResponse,
  TraceEvent,
} from '../types';
import {
  formatEventSentence,
  formatRunId,
  getEvidenceLabel,
  getEventTypeLabel,
  getFailureClassLabel,
  getFaultLabel,
  getPolicyLabel,
  getScenarioLabel,
  getToolLabel,
} from '../lib/labels';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Filter,
  Flame,
  GitCompare,
  Lightbulb,
  Maximize2,
  Minimize2,
  RotateCcw,
  Shield,
  ShieldAlert,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';

export const TraceDiagnosis: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const urlRunId = searchParams.get('runId');
  const [selectedRunId, setSelectedRunId] = useState<string>(urlRunId || '');
  const [compareRunId, setCompareRunId] = useState<string>('');
  const [isCompareMode, setIsCompareMode] = useState<boolean>(false);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [toolFilter, setToolFilter] = useState<string>('all');
  const [selectedEvent, setSelectedEvent] = useState<TraceEvent | null>(null);

  // Shrinker & Hardening state
  const [shrinkResult, setShrinkResult] = useState<MinimalFaultSet | null>(null);
  const [hardeningResult, setHardeningResult] = useState<HardeningResult | null>(null);
  const [diagnosisData, setDiagnosisData] = useState<Diagnosis | null>(null);

  // Fetch runs list for selector
  const { data: runsList } = useQuery({
    queryKey: ['runs-list'],
    queryFn: () => fetchRuns(50, 0),
    refetchInterval: 5000,
  });

  // Automatically select the first run if none selected
  useEffect(() => {
    if (!selectedRunId && runsList && runsList.length > 0) {
      const firstId = runsList[0].id;
      setSelectedRunId(firstId);
      setSearchParams({ runId: firstId });
    }
  }, [runsList, selectedRunId, setSearchParams]);

  // Primary Run Query
  const { data: currentRun, isLoading: runLoading } = useQuery({
    queryKey: ['run', selectedRunId],
    queryFn: () => (selectedRunId ? fetchRun(selectedRunId) : null),
    enabled: !!selectedRunId,
  });

  // Compare Run Query
  const { data: compareRun } = useQuery({
    queryKey: ['run', compareRunId],
    queryFn: () => (compareRunId ? fetchRun(compareRunId) : null),
    enabled: !!compareRunId && isCompareMode,
  });

  // Reset local state when selected run changes
  useEffect(() => {
    setShrinkResult(null);
    setHardeningResult(null);
    if (selectedRunId) {
      diagnoseRun(selectedRunId)
        .then((diag) => setDiagnosisData(diag))
        .catch(() => setDiagnosisData(null));
    }
  }, [selectedRunId]);

  // Shrink Mutation
  const shrinkMutation = useMutation({
    mutationFn: (runId: string) => shrinkRun(runId, 20),
    onSuccess: (data) => setShrinkResult(data),
  });

  // Harden Mutation
  const hardenMutation = useMutation({
    mutationFn: (runId: string) => hardenRun(runId),
    onSuccess: (data) => {
      setHardeningResult(data);
      queryClient.invalidateQueries({ queryKey: ['runs-list'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
    },
  });

  const getVerdictBadge = (verdict?: string) => {
    switch (verdict) {
      case 'PASSED':
        return (
          <span className="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-900/60 text-emerald-300 border border-emerald-700">
            PASSED
          </span>
        );
      case 'BLOCKED':
        return (
          <span className="px-2.5 py-1 rounded text-xs font-semibold bg-purple-900/60 text-purple-300 border border-purple-700">
            BLOCKED
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded text-xs font-semibold bg-rose-900/60 text-rose-300 border border-rose-700">
            FAILED
          </span>
        );
    }
  };

  const getEventBadge = (type: string) => {
    const norm = type.toLowerCase();
    const label = getEventTypeLabel(type);
    if (norm === 'thought') {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
          {label}
        </span>
      );
    }
    if (norm === 'tool_call') {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-blue-950/60 text-blue-300 border border-blue-800">
          {label}
        </span>
      );
    }
    if (norm === 'fault_injected') {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-rose-950/60 text-rose-300 border border-rose-800">
          {label}
        </span>
      );
    }
    if (norm === 'final_answer') {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800">
          {label}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800/80 text-slate-300 border border-slate-700">
        {label}
      </span>
    );
  };

  // Filter trace events
  const filteredTrace =
    currentRun?.trace.filter((event) => {
      const normType = event.type.toLowerCase();
      if (typeFilter !== 'all') {
        if (typeFilter === 'thought' && normType !== 'thought') return false;
        if (typeFilter === 'tool_call' && normType !== 'tool_call') return false;
        if (typeFilter === 'tool_result' && normType !== 'tool_result' && normType !== 'result') return false;
        if (typeFilter === 'fault_injected' && normType !== 'fault_injected') return false;
        if (typeFilter === 'final_answer' && normType !== 'final_answer') return false;
      }
      if (toolFilter !== 'all' && event.tool !== toolFilter) return false;
      return true;
    }) || [];

  // Determine dynamic diagnosis title
  const getDiagnosisCardTitle = () => {
    if (!currentRun) return 'Run summary';
    const verdict = currentRun.grader_result.verdict;
    if (verdict === 'PASSED') {
      const recovered = currentRun.grader_result.faults_recovered;
      if (recovered > 0) {
        return `Run summary: recovered from ${recovered} fault${recovered > 1 ? 's' : ''}`;
      }
      return 'Run summary: passed with no faults';
    }
    return 'Why it failed';
  };

  return (
    <div className="space-y-8">
      {/* Page Title & Run Selector */}
      <div className="border border-indigo-900/40 bg-gradient-to-r from-slate-900 via-indigo-950/20 to-slate-900 rounded-xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-indigo-400 text-xs tracking-wider uppercase mb-1 font-semibold">
              <Terminal className="w-4 h-4" /> Trace Explorer & Counterfactual Diagnosis
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Execution Trace & Policy Diagnosis</h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Inspect fine-grained event trajectories, reproduce minimal fault sets with delta debugging, and verify automated policy patches.
            </p>
          </div>

          {/* Run Selectors */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <select
              value={selectedRunId}
              onChange={(e) => {
                setSelectedRunId(e.target.value);
                setSearchParams({ runId: e.target.value });
              }}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs"
            >
              {runsList?.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatRunId(r.id)} ({getScenarioLabel(r.scenario_id)} - {r.grader_result.verdict})
                </option>
              ))}
            </select>

            <button
              onClick={() => setIsCompareMode(!isCompareMode)}
              className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                isCompareMode
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>{isCompareMode ? 'Exit comparison' : 'Compare run'}</span>
            </button>
          </div>
        </div>

        {/* Comparison Target Selector */}
        {isCompareMode && (
          <div className="mt-4 pt-4 border-t border-slate-800 flex items-center gap-3">
            <span className="text-xs text-indigo-300 font-medium">Compare with:</span>
            <select
              value={compareRunId}
              onChange={(e) => setCompareRunId(e.target.value)}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-xs"
            >
              <option value="">Select counterfactual run to compare...</option>
              {runsList
                ?.filter((r) => r.id !== selectedRunId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatRunId(r.id)} ({getScenarioLabel(r.scenario_id)} - {r.grader_result.verdict})
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* Run Metadata Header Card */}
      {currentRun && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-xs">Verdict:</span>
                {getVerdictBadge(currentRun.grader_result.verdict)}
              </div>
              <div className="h-4 w-px bg-slate-800"></div>
              <div>
                <span className="text-slate-400 text-xs">Scenario:</span>{' '}
                <span className="text-white text-xs font-semibold">
                  {getScenarioLabel(currentRun.scenario_id)}
                </span>
              </div>
              <div className="h-4 w-px bg-slate-800"></div>
              <div>
                <span className="text-slate-400 text-xs">Policy:</span>{' '}
                <span className="text-white text-xs font-semibold">
                  {getPolicyLabel(currentRun.agent_type)}
                </span>
              </div>
              <div className="h-4 w-px bg-slate-800"></div>
              <div>
                <span className="text-slate-400 text-xs">Seed:</span>{' '}
                <span className="text-white text-xs">{currentRun.seed}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>{currentRun.metrics.tool_calls} actions</span>
              <span>•</span>
              <span>{currentRun.metrics.tool_errors} errors</span>
              <span>•</span>
              <span>{currentRun.metrics.faults_recovered} of {currentRun.metrics.faults_encountered} faults recovered</span>
              <span>•</span>
              <span>{currentRun.metrics.execution_time_ms} ms</span>
            </div>
          </div>

          {currentRun.grader_result.failure_class && currentRun.grader_result.failure_class !== 'NONE' && (
            <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-2">
              <span className="text-xs text-rose-400 font-semibold">Failure category:</span>
              <span className="px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-medium">
                {getFailureClassLabel(currentRun.grader_result.failure_class)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Main Grid: Timeline (2 cols) & Diagnosis/Shrinker/Hardener (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 cols): Filters & Trace Events */}
        <div className="lg:col-span-2 space-y-4">
          {/* Timeline Filter Bar */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Filter className="w-3.5 h-3.5" />
              <span>Filter events:</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs"
              >
                <option value="all">All event types</option>
                <option value="thought">Reasoning</option>
                <option value="tool_call">Action</option>
                <option value="tool_result">Result</option>
                <option value="fault_injected">Fault injected</option>
                <option value="final_answer">Conclusion</option>
              </select>

              <select
                value={toolFilter}
                onChange={(e) => setToolFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs"
              >
                <option value="all">All tools</option>
                <option value="get_health">Check health</option>
                <option value="get_errors">Read error logs</option>
                <option value="request_rollback">Roll back deploy</option>
                <option value="verify_recovery">Verify recovery</option>
              </select>
            </div>

            <div className="text-slate-500 text-xs">
              Showing {filteredTrace.length} events
            </div>
          </div>

          {/* Timeline Events List */}
          <div className="space-y-2">
            {filteredTrace.map((event) => (
              <div
                key={event.event_id}
                onClick={() => setSelectedEvent(event)}
                className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start gap-3.5 ${
                  selectedEvent?.event_id === event.event_id
                    ? 'border-indigo-500 bg-indigo-950/20'
                    : event.type === 'fault_injected'
                    ? 'border-rose-900/60 bg-rose-950/20 hover:border-rose-700'
                    : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-bold text-indigo-400 shrink-0 pt-0.5">
                  {event.event_id}
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getEventBadge(event.type)}
                    {event.tool && (
                      <span className="text-xs font-semibold text-slate-300">
                        {getToolLabel(event.tool)}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-200 leading-relaxed">
                    {formatEventSentence({
                      type: event.type,
                      tool: event.tool,
                      input: event.input,
                      output: event.output,
                      error: event.error,
                      fault_injected: event.details?.fault_spec
                        ? {
                            type: event.details.fault_spec.type,
                            call_index: event.details.fault_spec.call_index,
                            total_faults: event.details.fault_spec.count,
                          }
                        : null,
                      thought: event.details?.thought,
                      details: event.details,
                    })}
                  </p>
                </div>

                <ChevronRight className="w-4 h-4 text-slate-600 shrink-0 self-center" />
              </div>
            ))}
          </div>
        </div>

        {/* Right Column (1 col): Diagnosis, Shrinker, Hardening */}
        <div className="space-y-6">
          {/* Diagnosis Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-400" /> {getDiagnosisCardTitle()}
              </h3>
              <span className="text-[10px] text-slate-500">Automated diagnosis</span>
            </div>

            {diagnosisData ? (
              <div className="space-y-3.5 text-xs">
                {/* Observed Facts */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider">
                    Observed facts
                  </div>
                  <ul className="space-y-1.5 text-slate-300">
                    {(diagnosisData.observed_facts || []).map((fact, idx) => (
                      <li key={idx} className="flex items-start gap-1.5 leading-relaxed">
                        <span className="text-indigo-400 font-bold">•</span>
                        <span>{fact}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Inferred Explanation */}
                {diagnosisData.inferred_explanation && (
                  <div className="space-y-1 pt-2 border-t border-slate-800">
                    <div className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider">
                      Explanation
                    </div>
                    <p className="text-slate-300 leading-relaxed bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                      {diagnosisData.inferred_explanation}
                    </p>
                  </div>
                )}

                {/* Root Cause */}
                {diagnosisData.root_cause && (
                  <div className="space-y-1 pt-2 border-t border-slate-800">
                    <div className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider">
                      Root cause
                    </div>
                    <div className="p-2 rounded bg-amber-950/30 border border-amber-800 text-amber-300 font-medium leading-relaxed">
                      {diagnosisData.root_cause}
                    </div>
                  </div>
                )}

                {/* Missing Evidence */}
                {diagnosisData.missing_evidence && diagnosisData.missing_evidence.length > 0 && (
                  <div className="space-y-1 pt-2 border-t border-slate-800">
                    <div className="font-semibold text-rose-400 uppercase text-[10px] tracking-wider">
                      Missing verification
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {diagnosisData.missing_evidence.map((ev) => (
                        <span key={ev} className="px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
                          {getEvidenceLabel(ev)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {diagnosisData.recommendations && diagnosisData.recommendations.length > 0 && (
                  <div className="space-y-1 pt-2 border-t border-slate-800">
                    <div className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider">
                      Recommendations
                    </div>
                    <ul className="space-y-1.5 text-emerald-300">
                      {diagnosisData.recommendations.map((rec, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 leading-relaxed">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-slate-500 text-xs">Loading diagnosis...</div>
            )}
          </div>

          {/* Fault Shrinker Panel */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Minimize2 className="w-4 h-4 text-indigo-400" /> Minimal Fault Reduction
              </h3>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Isolates the absolute minimal set of faults required to reproduce this run&apos;s failure.
            </p>

            <button
              onClick={() => selectedRunId && shrinkMutation.mutate(selectedRunId)}
              disabled={shrinkMutation.isPending || currentRun?.grader_result.verdict === 'PASSED'}
              className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition"
            >
              {shrinkMutation.isPending ? 'Finding minimal set...' : 'Find minimal fault set'}
            </button>

            {shrinkResult && (
              <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Original faults:</span>
                  <span className="font-bold text-rose-400">{shrinkResult.original_fault_count}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Minimal breaking faults:</span>
                  <span className="font-bold text-amber-400">{shrinkResult.minimal_fault_count}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Test executions:</span>
                  <span className="text-slate-200">{shrinkResult.iterations_count}</span>
                </div>

                <div className="pt-2 border-t border-slate-800">
                  <div className="font-semibold text-slate-300 mb-1.5 text-xs">Minimal breaking set:</div>
                  <div className="space-y-1 text-xs">
                    {shrinkResult.minimal_faults.map((f) => (
                      <div key={f.fault_id} className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-300 flex items-center justify-between">
                        <span>{getFaultLabel(f.type)} on {getToolLabel(f.tool)}</span>
                        <span className="text-slate-400">at call #{f.call_index}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <details data-technical-details="true" className="mt-2 pt-2 border-t border-slate-800 text-[11px]">
                  <summary className="text-slate-500 cursor-pointer hover:text-slate-300">Technical details</summary>
                  <pre className="p-2 mt-1 rounded bg-slate-950 border border-slate-800 text-slate-400 overflow-x-auto">
                    {JSON.stringify(shrinkResult.counterfactual_runs, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>

          {/* Auto-Hardening Loop Panel */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" /> Auto-Hardening Loop
              </h3>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Synthesizes a targeted policy patch for failing faults and re-runs under identical conditions to verify recovery.
            </p>

            <button
              onClick={() => selectedRunId && hardenMutation.mutate(selectedRunId)}
              disabled={hardenMutation.isPending}
              className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition"
            >
              {hardenMutation.isPending ? 'Hardening and re-running...' : 'Auto-harden policy and verify'}
            </button>

            {hardeningResult && (
              <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Verification re-run:</span>
                  <span className="px-2 py-0.5 rounded font-semibold bg-emerald-950 border border-emerald-800 text-emerald-300">
                    {hardeningResult.re_run_verdict}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="font-semibold text-slate-400 text-[10px] uppercase">Policy changes:</span>
                  <div className="space-y-1 text-xs">
                    {Object.entries(hardeningResult.policy_diff).map(([key, diff]) => (
                      <div key={key} className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-300 flex items-center justify-between">
                        <span>{key.replace(/_/g, ' ')}</span>
                        <span className="text-emerald-400">{String(diff.before)} → {String(diff.after)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="font-semibold text-slate-400 text-[10px] uppercase">Fixed failure:</span>
                  <div className="flex flex-wrap gap-1">
                    {hardeningResult.fixed_failures.map((f) => (
                      <span key={f} className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs">
                        ✓ {getFailureClassLabel(f)}
                      </span>
                    ))}
                  </div>
                </div>

                <details data-technical-details="true" className="mt-2 pt-2 border-t border-slate-800 text-[11px]">
                  <summary className="text-slate-500 cursor-pointer hover:text-slate-300">Technical details</summary>
                  <pre className="p-2 mt-1 rounded bg-slate-950 border border-slate-800 text-slate-400 overflow-x-auto">
                    {JSON.stringify({ re_run_id: hardeningResult.re_run_id, diff: hardeningResult.policy_diff }, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Event Detail Drawer / Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-indigo-400 text-sm">{selectedEvent.event_id}</span>
                {getEventBadge(selectedEvent.type)}
                {selectedEvent.tool && (
                  <span className="text-xs text-white font-medium">
                    {getToolLabel(selectedEvent.tool)}
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div>
                <span className="text-slate-500 uppercase text-[10px] font-semibold">Event summary:</span>
                <p className="text-slate-200 text-sm mt-1 leading-relaxed">
                  {formatEventSentence({
                    type: selectedEvent.type,
                    tool: selectedEvent.tool,
                    input: selectedEvent.input,
                    output: selectedEvent.output,
                    error: selectedEvent.error,
                    fault_injected: selectedEvent.details?.fault_spec
                      ? {
                          type: selectedEvent.details.fault_spec.type,
                          call_index: selectedEvent.details.fault_spec.call_index,
                          total_faults: selectedEvent.details.fault_spec.count,
                        }
                      : null,
                    thought: selectedEvent.details?.thought,
                    details: selectedEvent.details,
                  })}
                </p>
              </div>

              <div>
                <span className="text-slate-500 uppercase text-[10px] font-semibold">Timestamp:</span>
                <div className="text-slate-300 mt-0.5">{selectedEvent.timestamp}</div>
              </div>

              {selectedEvent.error && (
                <div>
                  <span className="text-rose-400 uppercase text-[10px] font-semibold">Error:</span>
                  <div className="p-2.5 rounded bg-rose-950/40 text-rose-300 border border-rose-800 mt-1">
                    {selectedEvent.error}
                  </div>
                </div>
              )}

              {/* Collapsed Technical Details */}
              <details data-technical-details="true" className="mt-4 pt-3 border-t border-slate-800">
                <summary className="text-xs font-semibold text-slate-400 cursor-pointer hover:text-slate-200">
                  Technical details
                </summary>
                <div className="space-y-3 mt-3">
                  {selectedEvent.input && (
                    <div>
                      <span className="text-slate-500 uppercase text-[10px]">Arguments:</span>
                      <pre className="p-2.5 rounded bg-slate-950 text-slate-300 overflow-x-auto border border-slate-800 mt-1">
                        {JSON.stringify(selectedEvent.input, null, 2)}
                      </pre>
                    </div>
                  )}

                  {selectedEvent.output !== undefined && (
                    <div>
                      <span className="text-slate-500 uppercase text-[10px]">Output:</span>
                      <pre className="p-2.5 rounded bg-slate-950 text-slate-300 overflow-x-auto border border-slate-800 mt-1">
                        {typeof selectedEvent.output === 'object'
                          ? JSON.stringify(selectedEvent.output, null, 2)
                          : String(selectedEvent.output)}
                      </pre>
                    </div>
                  )}

                  {selectedEvent.details && (
                    <div>
                      <span className="text-slate-500 uppercase text-[10px]">Details:</span>
                      <pre className="p-2.5 rounded bg-slate-950 text-slate-300 overflow-x-auto border border-slate-800 mt-1">
                        {JSON.stringify(selectedEvent.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            </div>

            <div className="p-3 border-t border-slate-800 bg-slate-950 flex justify-end">
              <button
                onClick={() => setSelectedEvent(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
