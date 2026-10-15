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
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Code2,
  Filter,
  Flame,
  GitCompare,
  Lightbulb,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
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
    mutationFn: (id: string) => shrinkRun(id),
    onSuccess: (data) => setShrinkResult(data),
  });

  // Harden Mutation
  const hardenMutation = useMutation({
    mutationFn: (id: string) => hardenRun(id),
    onSuccess: (data) => {
      setHardeningResult(data);
      queryClient.invalidateQueries({ queryKey: ['runs-list'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
    },
  });

  const handleSelectRun = (id: string) => {
    setSelectedRunId(id);
    setSearchParams({ runId: id });
  };

  const filteredTrace = currentRun?.trace.filter((evt) => {
    if (typeFilter !== 'all' && evt.type !== typeFilter) return false;
    if (toolFilter !== 'all' && evt.tool !== toolFilter) return false;
    return true;
  }) || [];

  const getEventBadge = (type: string) => {
    switch (type) {
      case 'tool_call':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-950 text-blue-300 border border-blue-800">TOOL_CALL</span>;
      case 'tool_result':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">RESULT</span>;
      case 'fault_injected':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-rose-950 text-rose-300 border border-rose-800 flex items-center gap-1 font-bold"><Flame className="w-3 h-3" /> FAULT_INJECTED</span>;
      case 'policy_violation':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-950 text-purple-300 border border-purple-800 flex items-center gap-1 font-bold"><ShieldAlert className="w-3 h-3" /> VIOLATION</span>;
      case 'thought':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800">THOUGHT</span>;
      case 'final_answer':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">FINAL</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-800 text-gray-400 border border-gray-700">{type.toUpperCase()}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Run Selection & Comparison Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <label className="text-xs font-semibold text-slate-400">Target Run:</label>
          <select
            value={selectedRunId}
            onChange={(e) => handleSelectRun(e.target.value)}
            className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white font-mono text-xs max-w-xs"
          >
            {runsList?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} — [{r.grader_result.verdict}] {r.scenario_id} ({r.agent_type})
              </option>
            ))}
          </select>

          <button
            onClick={() => setIsCompareMode(!isCompareMode)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
              isCompareMode
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" /> Compare Runs
          </button>

          {isCompareMode && (
            <select
              value={compareRunId}
              onChange={(e) => setCompareRunId(e.target.value)}
              className="px-3 py-1.5 bg-slate-800 border border-indigo-700 rounded-lg text-white font-mono text-xs max-w-xs"
            >
              <option value="">Select second run to compare...</option>
              {runsList
                ?.filter((r) => r.id !== selectedRunId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} — [{r.grader_result.verdict}] {r.scenario_id} ({r.agent_type})
                  </option>
                ))}
            </select>
          )}
        </div>

        {currentRun && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-slate-400">Verdict:</span>
            <span
              className={`px-2 py-0.5 rounded font-bold ${
                currentRun.grader_result.verdict === 'PASSED'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : currentRun.grader_result.verdict === 'BLOCKED'
                  ? 'bg-purple-950 text-purple-300 border border-purple-800'
                  : 'bg-rose-950 text-rose-300 border border-rose-800'
              }`}
            >
              {currentRun.grader_result.verdict}
            </span>
            <span className="text-slate-400 font-mono">
              Calls: {currentRun.grader_result.tool_calls} | Enc/Rec Faults:{' '}
              {currentRun.grader_result.faults_encountered}/{currentRun.grader_result.faults_recovered}
            </span>
          </div>
        )}
      </div>

      {/* Main Grid: Timeline + Diagnosis/Shrink/Harden Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 cols): Trace Timeline */}
        <div className="lg:col-span-2 space-y-4">
          {/* Timeline Filters */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-400 font-medium">Filter Events:</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs"
              >
                <option value="all">All Event Types</option>
                <option value="tool_call">Tool Calls</option>
                <option value="tool_result">Tool Results</option>
                <option value="fault_injected">Faults Injected</option>
                <option value="policy_violation">Policy Violations</option>
                <option value="thought">Thoughts</option>
                <option value="final_answer">Final Answer</option>
              </select>

              <select
                value={toolFilter}
                onChange={(e) => setToolFilter(e.target.value)}
                className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs"
              >
                <option value="all">All Tools</option>
                <option value="get_health">get_health</option>
                <option value="get_errors">get_errors</option>
                <option value="request_rollback">request_rollback</option>
                <option value="verify_recovery">verify_recovery</option>
              </select>
            </div>
            <div className="text-slate-500 font-mono text-[11px]">
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
                    : event.type === 'policy_violation'
                    ? 'border-purple-900/60 bg-purple-950/20 hover:border-purple-700'
                    : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                }`}
              >
                <div className="font-mono text-xs font-bold text-indigo-400 shrink-0 pt-0.5">
                  {event.event_id}
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getEventBadge(event.type)}
                    {event.tool && (
                      <span className="font-mono text-xs font-bold text-slate-200">{event.tool}()</span>
                    )}
                    <span className="text-[10px] text-slate-500 ml-auto font-mono">
                      Step {event.step_index}
                    </span>
                  </div>

                  {event.type === 'thought' && (
                    <p className="text-xs text-slate-300 italic">{event.details?.thought}</p>
                  )}

                  {event.type === 'tool_call' && (
                    <div className="text-xs font-mono text-slate-400 truncate">
                      args: {JSON.stringify(event.input)}
                    </div>
                  )}

                  {event.type === 'fault_injected' && (
                    <div className="text-xs text-rose-300 font-medium">
                      Injected {event.details?.fault_spec?.type} fault into {event.tool} (call index {event.details?.fault_spec?.call_index})
                    </div>
                  )}

                  {event.type === 'policy_violation' && (
                    <div className="text-xs text-purple-300 font-medium">
                      {event.error}
                    </div>
                  )}

                  {event.type === 'tool_result' && (
                    <div className="text-xs font-mono text-slate-400 line-clamp-2">
                      {typeof event.output === 'object' ? JSON.stringify(event.output) : String(event.output)}
                    </div>
                  )}

                  {event.type === 'final_answer' && (
                    <div className="text-xs text-emerald-400 font-medium">
                      Concluded: {event.details?.finish_reason}
                    </div>
                  )}
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
                <Lightbulb className="w-4 h-4 text-amber-400" /> Root-Cause Diagnosis
              </h3>
              <span className="text-[10px] text-slate-500 font-mono">Rule-based Engine</span>
            </div>

            {diagnosisData ? (
              <div className="space-y-3.5 text-xs">
                {/* Observed Facts */}
                <div className="space-y-1">
                  <div className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider">
                    Observed Facts (Trace Citations):
                  </div>
                  <ul className="space-y-1 text-slate-300">
                    {diagnosisData.observed_facts.map((fact, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-indigo-400 font-mono font-bold">•</span>
                        <span>{fact}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Inferred Explanation */}
                <div className="space-y-1 pt-2 border-t border-slate-800">
                  <div className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider">
                    Inferred Explanation:
                  </div>
                  <p className="text-slate-300 leading-relaxed bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                    {diagnosisData.inferred_explanation}
                  </p>
                </div>

                {/* Root Cause */}
                <div className="space-y-1 pt-2 border-t border-slate-800">
                  <div className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider">
                    Root Cause:
                  </div>
                  <div className="p-2 rounded bg-amber-950/30 border border-amber-800 text-amber-300 font-medium">
                    {diagnosisData.root_cause}
                  </div>
                </div>

                {/* Missing Evidence */}
                {diagnosisData.missing_evidence.length > 0 && (
                  <div className="space-y-1 pt-2 border-t border-slate-800">
                    <div className="font-semibold text-rose-400 uppercase text-[10px] tracking-wider">
                      Missing Telemetry Evidence:
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {diagnosisData.missing_evidence.map((ev) => (
                        <span key={ev} className="px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-800 text-rose-300 font-mono text-[10px]">
                          {ev}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                <div className="space-y-1 pt-2 border-t border-slate-800">
                  <div className="font-semibold text-slate-400 uppercase text-[10px] tracking-wider">
                    Policy Recommendations:
                  </div>
                  <ul className="space-y-1 text-emerald-300">
                    {diagnosisData.recommendations.map((rec, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="text-slate-500 text-xs">Loading diagnosis telemetry...</div>
            )}
          </div>

          {/* Fault Shrinker Panel */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Minimize2 className="w-4 h-4 text-indigo-400" /> Minimal Fault Reduction (ddmin)
              </h3>
            </div>

            <p className="text-xs text-slate-400">
              Isolates the absolute minimal set of faults required to reproduce this run&apos;s failure class.
            </p>

            <button
              onClick={() => selectedRunId && shrinkMutation.mutate(selectedRunId)}
              disabled={shrinkMutation.isPending || currentRun?.grader_result.verdict === 'PASSED'}
              className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition"
            >
              {shrinkMutation.isPending ? 'Executing ddmin Reduction...' : 'Find Minimal Fault Set'}
            </button>

            {shrinkResult && (
              <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Original Faults:</span>
                  <span className="font-mono font-bold text-rose-400">{shrinkResult.original_fault_count}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Minimal Breaking Faults:</span>
                  <span className="font-mono font-bold text-amber-400">{shrinkResult.minimal_fault_count}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Counterfactual Probes:</span>
                  <span className="font-mono text-slate-200">{shrinkResult.iterations_count}</span>
                </div>

                <div className="pt-2 border-t border-slate-800">
                  <div className="font-semibold text-slate-300 mb-1 text-[11px]">Minimal Fault Set:</div>
                  <div className="space-y-1 font-mono text-[11px]">
                    {shrinkResult.minimal_faults.map((f) => (
                      <div key={f.fault_id} className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-300">
                        {f.fault_id}: {f.type} on {f.tool}() at call {f.call_index}
                      </div>
                    ))}
                  </div>
                </div>
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

            <p className="text-xs text-slate-400">
              Synthesizes a targeted PolicyConfig patch for failing faults and re-runs on identical conditions to prove the improvement.
            </p>

            <button
              onClick={() => selectedRunId && hardenMutation.mutate(selectedRunId)}
              disabled={hardenMutation.isPending}
              className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition"
            >
              {hardenMutation.isPending ? 'Hardening & Re-running...' : 'Auto-Harden Policy & Verify'}
            </button>

            {hardeningResult && (
              <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Measured Re-run Verdict:</span>
                  <span className="px-2 py-0.5 rounded font-bold font-mono bg-emerald-950 border border-emerald-800 text-emerald-300">
                    {hardeningResult.re_run_verdict}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="font-semibold text-slate-400 text-[10px] uppercase">Policy Patches Applied:</span>
                  <div className="space-y-1 font-mono text-[11px]">
                    {Object.entries(hardeningResult.policy_diff).map(([key, diff]) => (
                      <div key={key} className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-300 flex items-center justify-between">
                        <span>{key}</span>
                        <span className="text-emerald-400">{String(diff.before)} → {String(diff.after)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="font-semibold text-slate-400 text-[10px] uppercase">Fixed Failures:</span>
                  <div className="flex flex-wrap gap-1">
                    {hardeningResult.fixed_failures.map((f) => (
                      <span key={f} className="px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800 text-emerald-300 font-mono text-[10px]">
                        ✓ {f}
                      </span>
                    ))}
                  </div>
                </div>
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
                <span className="font-mono font-bold text-indigo-400 text-sm">{selectedEvent.event_id}</span>
                {getEventBadge(selectedEvent.type)}
                {selectedEvent.tool && (
                  <span className="font-mono text-xs text-white">{selectedEvent.tool}()</span>
                )}
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 font-mono text-xs">
              <div>
                <span className="text-slate-500 uppercase text-[10px]">Timestamp:</span>
                <div className="text-slate-300">{selectedEvent.timestamp}</div>
              </div>

              {selectedEvent.input && (
                <div>
                  <span className="text-slate-500 uppercase text-[10px]">Arguments:</span>
                  <pre className="p-2.5 rounded bg-slate-950 text-slate-300 overflow-x-auto border border-slate-800">
                    {JSON.stringify(selectedEvent.input, null, 2)}
                  </pre>
                </div>
              )}

              {selectedEvent.output !== undefined && (
                <div>
                  <span className="text-slate-500 uppercase text-[10px]">Tool Output:</span>
                  <pre className="p-2.5 rounded bg-slate-950 text-slate-300 overflow-x-auto border border-slate-800">
                    {typeof selectedEvent.output === 'object'
                      ? JSON.stringify(selectedEvent.output, null, 2)
                      : String(selectedEvent.output)}
                  </pre>
                </div>
              )}

              {selectedEvent.details && (
                <div>
                  <span className="text-slate-500 uppercase text-[10px]">Event Details:</span>
                  <pre className="p-2.5 rounded bg-slate-950 text-slate-300 overflow-x-auto border border-slate-800">
                    {JSON.stringify(selectedEvent.details, null, 2)}
                  </pre>
                </div>
              )}

              {selectedEvent.error && (
                <div>
                  <span className="text-rose-400 uppercase text-[10px]">Error Details:</span>
                  <div className="p-2.5 rounded bg-rose-950/40 text-rose-300 border border-rose-800">
                    {selectedEvent.error}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-slate-800 bg-slate-950 flex justify-end">
              <button
                onClick={() => setSelectedEvent(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
