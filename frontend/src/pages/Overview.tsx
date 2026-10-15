import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchMetrics, fetchRuns, fetchMatrixBatches } from '../api';
import { HowThisWorks } from '../components/HowThisWorks';
import {
  formatRunId,
  getFaultLabel,
  getPolicyLabel,
  getScenarioLabel,
} from '../lib/labels';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  Flame,
  Info,
  Layers,
  Percent,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

export const Overview: React.FC = () => {
  const [selectedScenario, setSelectedScenario] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'single' | 'batch' | 'all'>('single');
  const [viewModeSetByUser, setViewModeSetByUser] = useState<boolean>(false);
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [filterScenario, setFilterScenario] = useState<string>('all');
  const [filterResult, setFilterResult] = useState<string>('all');
  const [expandedBatches, setExpandedBatches] = useState<Record<string, boolean>>({});

  const { data: metricsData } = useQuery({
    queryKey: ['metrics', selectedScenario],
    queryFn: () => fetchMetrics(selectedScenario),
    staleTime: 0,
    refetchInterval: 5000,
  });

  // Query initial runs to determine if any single tests exist
  const { data: allRunsData } = useQuery({
    queryKey: ['recent-runs-initial'],
    queryFn: () => fetchRuns(20, 0),
    staleTime: 5000,
  });

  useEffect(() => {
    if (!viewModeSetByUser && allRunsData) {
      const hasSingle = allRunsData.some((r) => !r.batch_id);
      if (!hasSingle && allRunsData.length > 0) {
        setViewMode('all');
      } else if (hasSingle) {
        setViewMode('single');
      }
    }
  }, [allRunsData, viewModeSetByUser]);

  const { data: runs } = useQuery({
    queryKey: ['recent-runs', viewMode, filterAgent, filterScenario, filterResult],
    queryFn: () =>
      fetchRuns(50, 0, {
        show: viewMode === 'batch' ? undefined : viewMode,
        agent: filterAgent,
        scenario_id: filterScenario,
        verdict: filterResult,
      }),
    staleTime: 0,
    refetchInterval: 5000,
  });

  const { data: matrixBatches } = useQuery({
    queryKey: ['matrix-batches'],
    queryFn: fetchMatrixBatches,
    staleTime: 0,
    refetchInterval: 5000,
  });

  const toggleBatch = (batchId: string) => {
    setExpandedBatches((prev) => ({
      ...prev,
      [batchId]: !prev[batchId],
    }));
  };

  const batchesList = Array.isArray(matrixBatches) ? matrixBatches : [];
  const filteredBatches = batchesList.filter((batch) => {
    if (filterAgent === 'all' && filterScenario === 'all' && filterResult === 'all') return true;
    return (batch.runs || []).some((r) => {
      if (filterAgent !== 'all' && r.agent_type !== filterAgent) return false;
      if (filterScenario !== 'all' && r.scenario_id !== filterScenario) return false;
      if (filterResult !== 'all' && r.grader_result.verdict !== filterResult) return false;
      return true;
    });
  });

  const aggs = metricsData?.aggregates;
  const heatmap = metricsData?.reliability_matrix || {};

  // Track highlighted cells on matrix value change
  const prevMatrixRef = useRef<Record<string, Record<string, number | null>>>({});
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set());

  const faultTypes = ['none', 'timeout', 'http_500', 'malformed_json', 'empty_response', 'transient_then_success'];
  const agentKeys = ['naive', 'robust', 'llm'];

  useEffect(() => {
    if (metricsData?.reliability_matrix) {
      const changed = new Set<string>();
      agentKeys.forEach((ag) => {
        faultTypes.forEach((ft) => {
          const key = `${ag}:${ft}`;
          const currentVal = metricsData.reliability_matrix[ag]?.[ft] ?? null;
          const prevVal = prevMatrixRef.current[ag]?.[ft];
          if (prevVal !== undefined && prevVal !== currentVal) {
            changed.add(key);
          }
        });
      });
      prevMatrixRef.current = metricsData.reliability_matrix;
      if (changed.size > 0) {
        setHighlightedCells(changed);
        const timer = setTimeout(() => {
          setHighlightedCells(new Set());
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [metricsData?.reliability_matrix]);


  // Baseline vs faulted unified data
  const bvf = metricsData?.baseline_vs_faulted?.overall;
  const chartData = [
    {
      name: 'Baseline',
      successRate: bvf?.baseline?.rate != null ? Math.round(bvf.baseline.rate * 100) : 0,
      total: bvf?.baseline?.total || 0,
      passed: bvf?.baseline?.passed || 0,
    },
    {
      name: 'Under faults',
      successRate: bvf?.faulted?.rate != null ? Math.round(bvf.faulted.rate * 100) : 0,
      total: bvf?.faulted?.total || 0,
      passed: bvf?.faulted?.passed || 0,
    },
  ];

  const getHeatmapColor = (val: number | null | undefined, isNA?: boolean) => {
    if (isNA) return 'bg-slate-800/80 text-slate-400 border-slate-700/60';
    if (val === null || val === undefined) return 'bg-gray-800 text-gray-400 border-gray-700';
    if (val >= 0.8) return 'bg-emerald-950/70 text-emerald-300 border-emerald-700/50';
    if (val >= 0.4) return 'bg-amber-950/70 text-amber-300 border-amber-700/50';
    return 'bg-rose-950/70 text-rose-300 border-rose-700/50';
  };

  const getVerdictBadge = (verdict: string) => {
    switch (verdict) {
      case 'PASSED':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-900/60 text-emerald-300 border border-emerald-700">PASSED</span>;
      case 'BLOCKED':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-900/60 text-purple-300 border border-purple-700">BLOCKED</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-900/60 text-rose-300 border border-rose-700">FAILED</span>;
    }
  };

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="border border-indigo-900/40 bg-gradient-to-r from-indigo-950/30 via-slate-900 to-slate-900 rounded-xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-indigo-400 text-xs tracking-wider uppercase mb-1 font-semibold">
              <Activity className="w-4 h-4" /> Agent Reliability Command Center
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">System Telemetry & Stress Analytics</h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Deterministic ops evaluation under controlled fault injection. Compares baseline resilience against transient degradation and prompt injections.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/lab"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition shadow-lg shadow-indigo-600/20"
            >
              Launch Run Lab <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* How This Works Helper Text */}
      <HowThisWorks />

      {(!aggs?.total_runs || aggs.total_runs === 0) && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-16 text-center flex flex-col items-center justify-center space-y-4">
          <Activity className="w-12 h-12 text-slate-600 mb-2" />
          <p className="text-base text-slate-300 font-medium">Run a test to see results.</p>
          <Link
            to="/lab"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition shadow-lg shadow-indigo-600/20"
          >
            Run full matrix
          </Link>
        </div>
      )}

      {aggs && aggs.total_runs > 0 && (
        <>

      {/* Last Run Strip */}
      {metricsData?.last_run && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 shadow-sm">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 text-slate-400 font-medium">
              <Clock className="w-3.5 h-3.5 text-indigo-400" /> Last run:
            </span>
            <span className="font-semibold text-white">
              {getScenarioLabel(metricsData.last_run.scenario_id)}
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-300">
              {getPolicyLabel(metricsData.last_run.agent_type)}
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400">
              Fault: {getFaultLabel(metricsData.last_run.fault_type)}
            </span>
            <span className="text-slate-600">•</span>
            <span>
              {getVerdictBadge(metricsData.last_run.verdict)}
            </span>
          </div>
          {metricsData.last_run.delta_text && (
            <div className="font-mono text-indigo-300 text-xs bg-indigo-950/60 border border-indigo-800/60 px-2.5 py-1 rounded">
              {metricsData.last_run.delta_text}
            </div>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Task Success */}
        <div
          title={aggs?.success_ci_95 ? `Likely range: ${Math.round(aggs.success_ci_95[0] * 100)}% – ${Math.round(aggs.success_ci_95[1] * 100)}%` : undefined}
          className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm cursor-help"
        >
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Task success</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {aggs?.success_rate !== null && aggs?.success_rate !== undefined
              ? `${Math.round(aggs.success_rate * 100)}%`
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {aggs?.success_count !== undefined && aggs?.total_runs !== undefined
              ? `${aggs.success_count} of ${aggs.total_runs.toLocaleString()} runs`
              : 'Completed runs'}
          </div>
        </div>

        {/* Tool Error Rate */}
        <div
          title={aggs?.tool_error_ci_95 ? `Likely range: ${Math.round(aggs.tool_error_ci_95[0] * 100)}% – ${Math.round(aggs.tool_error_ci_95[1] * 100)}%` : undefined}
          className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm cursor-help"
        >
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Tool error rate</span>
            <Wrench className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {aggs?.tool_error_rate !== null && aggs?.tool_error_rate !== undefined
              ? `${Math.round(aggs.tool_error_rate * 100)}%`
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {aggs?.tool_errors_count !== undefined && aggs?.tool_calls_total !== undefined
              ? `${aggs.tool_errors_count} of ${aggs.tool_calls_total.toLocaleString()} calls`
              : 'Tool errors'}
          </div>
        </div>

        {/* Fault Recovery */}
        <div
          title={aggs?.recovery_ci_95 ? `Likely range: ${Math.round(aggs.recovery_ci_95[0] * 100)}% – ${Math.round(aggs.recovery_ci_95[1] * 100)}%` : undefined}
          className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm cursor-help"
        >
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Fault recovery</span>
            <Percent className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {aggs?.recovery_rate !== null && aggs?.recovery_rate !== undefined
              ? `${Math.round(aggs.recovery_rate * 100)}%`
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {aggs?.faults_recovered_count !== undefined && aggs?.faults_encountered_count !== undefined
              ? `${aggs.faults_recovered_count} of ${aggs.faults_encountered_count.toLocaleString()} faults`
              : 'Faults recovered'}
          </div>
        </div>

        {/* Policy Violations */}
        <div
          title={aggs?.policy_violation_ci_95 ? `Likely range: ${Math.round(aggs.policy_violation_ci_95[0] * 100)}% – ${Math.round(aggs.policy_violation_ci_95[1] * 100)}%` : undefined}
          className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm cursor-help"
        >
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Policy violations</span>
            <ShieldAlert className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {aggs?.policy_violation_rate !== null && aggs?.policy_violation_rate !== undefined
              ? `${Math.round(aggs.policy_violation_rate * 100)}%`
              : '0%'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {aggs?.policy_violations_runs !== undefined && aggs?.total_runs !== undefined
              ? `${aggs.policy_violations_runs} of ${aggs.total_runs.toLocaleString()} runs`
              : 'Blocked runs'}
          </div>
        </div>

        {/* Avg Actions Per Run */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Avg actions per run</span>
            <Layers className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {aggs?.avg_tool_calls !== null && aggs?.avg_tool_calls !== undefined
              ? aggs.avg_tool_calls
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">across all completed runs</div>
        </div>

        {/* Drop Under Faults */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Drop under faults</span>
            <Flame className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {aggs?.recovery_degradation !== null && aggs?.recovery_degradation !== undefined
              ? `${Math.round(aggs.recovery_degradation * 100)}%`
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">baseline minus faulted</div>
        </div>
      </div>

      {/* Main Grid: Heatmap + Comparison Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Reliability Matrix Heatmap (2 cols) */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" /> Reliability Matrix
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Pass rates across agent policies and controlled fault injections.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="scenario-filter" className="text-xs text-slate-400 font-medium">
                  Scenario:
                </label>
                <select
                  id="scenario-filter"
                  data-testid="scenario-filter"
                  value={selectedScenario}
                  onChange={(e) => setSelectedScenario(e.target.value)}
                  className="px-2.5 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="all">All scenarios</option>
                  <option value="healthy_service">{getScenarioLabel('healthy_service')}</option>
                  <option value="bad_deploy">{getScenarioLabel('bad_deploy')}</option>
                  <option value="rollback_denied">{getScenarioLabel('rollback_denied')}</option>
                  <option value="unfixable_rollback">{getScenarioLabel('unfixable_rollback')}</option>
                  <option value="injected_instruction">{getScenarioLabel('injected_instruction')}</option>
                </select>
              </div>

              <div className="flex items-center gap-2 text-xs border-l border-slate-800 pl-3">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-700 inline-block"></span> ≥80%
                </span>
                <span className="flex items-center gap-1.5 text-amber-400">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-700 inline-block"></span> 40–79%
                </span>
                <span className="flex items-center gap-1.5 text-rose-400">
                  <span className="w-2.5 h-2.5 rounded-sm bg-rose-700 inline-block"></span> &lt;40%
                </span>
              </div>
            </div>
          </div>

          {/* Unwinnable Scenario Notice / Cap Explanation */}
          {selectedScenario === 'all' && (
            <div
              title="Rollback cannot fix persistent database corruption by design. This caps the aggregate success rate across all 5 scenarios at 80%."
              className="mb-4 p-2.5 rounded bg-indigo-950/40 border border-indigo-800/60 text-indigo-300 text-xs flex items-center gap-2 cursor-help"
            >
              <Info className="w-4 h-4 shrink-0 text-indigo-400" />
              <span>
                <strong>Unwinnable scenario cap:</strong> &ldquo;Rollback can&apos;t fix it&rdquo; has persistent database corruption and cannot be remediated (0% success), capping aggregate multi-scenario pass rate at 80.0%. Select individual scenarios above to inspect per-scenario results.
              </span>
            </div>
          )}

          {selectedScenario === 'unfixable_rollback' && (
            <div
              className="mb-4 p-2.5 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs flex items-center gap-2"
            >
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                <strong>Unwinnable incident:</strong> In &ldquo;Rollback can&apos;t fix it&rdquo;, the database is corrupted and rollback cannot remediate the degradation. Graded as failed remediation by design (capped at 0% pass rate).
              </span>
            </div>
          )}

          <div className="w-full">
            <table className="w-full text-xs text-left border-collapse table-fixed">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-2 font-semibold w-1/4">Policy</th>
                  {faultTypes.map((ft) => (
                    <th key={ft} className="py-2.5 px-1 text-center font-medium">
                      {getFaultLabel(ft)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {agentKeys.map((agent) => {
                  const agentData = heatmap[agent] || {};
                  const agentDetails = metricsData?.reliability_matrix_details?.[agent] || {};
                  const displayAgent = getPolicyLabel(agent);
                  return (
                    <tr key={agent} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-2 font-medium text-slate-200">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${agent === 'robust' ? 'bg-indigo-400' : agent === 'llm' ? 'bg-purple-400' : 'bg-amber-400'}`}></span>
                          <span className="truncate">{displayAgent}</span>
                        </div>
                      </td>
                      {faultTypes.map((ft) => {
                        const val = agentData[ft];
                        const detail = agentDetails[ft];
                        const isNotApplicable = detail?.not_applicable;
                        const displayVal = isNotApplicable
                          ? 'Not applicable'
                          : (val !== undefined && val !== null ? `${Math.round(val * 100)}%` : 'N/A');

                        let ciTooltip = '';
                        if (isNotApplicable) {
                          ciTooltip = 'Not applicable: Fault type was not encountered because the agent workflow for this scenario does not reach the targeted tool or call index.';
                        } else if (detail?.is_unwinnable) {
                          ciTooltip = `Pass rate: ${detail.passed}/${detail.total} (0%) • Unwinnable scenario (service corruption persists after rollback)`;
                        } else if (detail?.ci_lower !== null && detail?.ci_lower !== undefined) {
                          ciTooltip = `Pass rate: ${detail.passed}/${detail.total} (${displayVal}) • Likely range: ${(detail.ci_lower * 100).toFixed(1)}% – ${(detail.ci_upper * 100).toFixed(1)}%${detail.is_low_sample ? ' • Low sample size (<10 runs)' : ''}`;
                        } else {
                          ciTooltip = 'No runs recorded for this cell';
                        }

                        const cellKey = `${agent}:${ft}`;
                        const isHighlighted = highlightedCells.has(cellKey);

                        return (
                          <td key={ft} className="py-2 px-1 text-center">
                            <div
                              title={ciTooltip}
                              className={`py-1.5 px-1 rounded border text-xs font-semibold flex flex-col items-center justify-center cursor-help transition-all duration-300 ${
                                isHighlighted ? 'ring-2 ring-indigo-400 bg-indigo-900/90 scale-105' : ''
                              } ${getHeatmapColor(val, isNotApplicable)}`}
                            >
                              <span className={isNotApplicable ? 'text-[10px] font-medium leading-tight' : ''}>{displayVal}</span>
                              {detail && detail.total > 0 && !isNotApplicable && (
                                <span className="text-[10px] font-normal opacity-85">
                                  {detail.passed}/{detail.total}
                                </span>
                              )}
                              {detail && detail.is_low_sample && detail.total > 0 && !isNotApplicable && (
                                <span
                                  title="Low sample size (<10 runs)"
                                  className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block mt-0.5"
                                ></span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Metrics Note */}
          <div className="mt-4 p-3 rounded-lg bg-slate-950/70 border border-slate-800/80 text-xs text-slate-400 flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              Note: Basic and Resilient agents are author-written reference policies; this performance gap validates that the test harness reliably separates weak from hardened policies, and is not a discovery about AI agents in general.
            </span>
          </div>
        </div>

        {/* Baseline vs Faulted Chart (1 col) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-emerald-400" /> Baseline vs Faulted
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Pass rates under pristine baseline conditions versus active fault injection.
            </p>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} domain={[0, 100]} unit="%" />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(val: any, _name: any, item: any) => [
                      `${val}% (${item.payload.passed}/${item.payload.total} passed)`,
                      'Pass rate',
                    ]}
                  />
                  <Bar dataKey="successRate" radius={[4, 4, 0, 0]}>
                    <Cell fill="#10b981" />
                    <Cell fill="#ef4444" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
            <span>Total completed runs:</span>
            <span className="text-white font-bold">{aggs?.total_runs || 0}</span>
          </div>
        </div>
      </div>
      </>
      )}

      {/* Recent Runs Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" /> Recent Runs
            </h2>
            <p className="text-xs text-slate-400">
              Deterministic runs with trace recordings and automated grading assertions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Toggle: Show: Single tests | Matrix batches | All */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              <span className="text-slate-400 font-medium px-2 py-1">Show:</span>
              <button
                type="button"
                onClick={() => {
                  setViewMode('single');
                  setViewModeSetByUser(true);
                }}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  viewMode === 'single'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Single tests
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('batch');
                  setViewModeSetByUser(true);
                }}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  viewMode === 'batch'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Matrix batches
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('all');
                  setViewModeSetByUser(true);
                }}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  viewMode === 'all'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All
              </button>
            </div>

            <Link
              to="/trace"
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
            >
              View All Traces <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4 pt-3 border-t border-slate-800/60">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Filter by:</span>
          </div>

          <select
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            aria-label="Filter by agent"
            className="bg-slate-950 text-slate-200 border border-slate-800 text-xs rounded-lg px-2.5 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="all">All Agents</option>
            <option value="naive">Basic</option>
            <option value="robust">Resilient</option>
            <option value="llm">Language model</option>
          </select>

          <select
            value={filterScenario}
            onChange={(e) => setFilterScenario(e.target.value)}
            aria-label="Filter by scenario"
            className="bg-slate-950 text-slate-200 border border-slate-800 text-xs rounded-lg px-2.5 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="all">All Scenarios</option>
            <option value="bad_deploy">Bad deployment</option>
            <option value="injected_instruction">Malicious log instruction</option>
            <option value="unfixable_rollback">Rollback can&apos;t fix it</option>
            <option value="schema_drift">Undocumented schema drift</option>
          </select>

          <select
            value={filterResult}
            onChange={(e) => setFilterResult(e.target.value)}
            aria-label="Filter by result"
            className="bg-slate-950 text-slate-200 border border-slate-800 text-xs rounded-lg px-2.5 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="all">All Results</option>
            <option value="PASSED">Passed</option>
            <option value="FAILED">Failed</option>
          </select>

          {(filterAgent !== 'all' || filterScenario !== 'all' || filterResult !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setFilterAgent('all');
                setFilterScenario('all');
                setFilterResult('all');
              }}
              className="text-xs text-indigo-400 hover:text-indigo-300 ml-1 underline"
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Table content based on viewMode */}
        <div className="overflow-x-auto">
          {viewMode === 'batch' ? (
            /* Matrix batches view */
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 w-8"></th>
                  <th className="py-2.5 px-3">Batch ID</th>
                  <th className="py-2.5 px-3">Summary</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Total runs</th>
                  <th className="py-2.5 px-3">Pass rate</th>
                  <th className="py-2.5 px-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredBatches.length > 0 ? (
                  filteredBatches.map((batch) => {
                    const isExpanded = !!expandedBatches[batch.batch_id];
                    return (
                      <React.Fragment key={batch.batch_id}>
                        <tr
                          onClick={() => toggleBatch(batch.batch_id)}
                          className="hover:bg-slate-800/30 transition cursor-pointer"
                        >
                          <td className="py-2.5 px-3 text-slate-400">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-indigo-300 font-medium">
                            {formatRunId(batch.batch_id)}
                          </td>
                          <td className="py-2.5 px-3 text-slate-200 font-medium">
                            {batch.summary}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 uppercase">
                              {batch.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">{batch.total_runs} runs</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                batch.pass_rate >= 0.8
                                  ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
                                  : batch.pass_rate >= 0.4
                                  ? 'bg-amber-900/60 text-amber-300 border border-amber-700'
                                  : 'bg-rose-900/60 text-rose-300 border border-rose-700'
                              }`}
                            >
                              {Math.round(batch.pass_rate * 100)}%
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <span className="text-indigo-400 hover:text-indigo-300 text-xs font-medium">
                              {isExpanded ? 'Hide runs' : 'Show runs'}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-950/60">
                            <td colSpan={7} className="p-3">
                              <div className="rounded-lg border border-slate-800 overflow-hidden bg-slate-900/60">
                                <table className="w-full text-xs text-left border-collapse">
                                  <thead>
                                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                                      <th className="py-2 px-3">Run ID</th>
                                      <th className="py-2 px-3">Scenario</th>
                                      <th className="py-2 px-3">Policy</th>
                                      <th className="py-2 px-3">Verdict</th>
                                      <th className="py-2 px-3">Faults recovered</th>
                                      <th className="py-2 px-3">Tool calls</th>
                                      <th className="py-2 px-3 text-right">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-800/40">
                                    {(batch.runs || []).map((r) => (
                                      <tr key={r.id} className="hover:bg-slate-800/20 transition">
                                        <td className="py-2 px-3 text-indigo-300 font-medium">
                                          {formatRunId(r.id)}
                                        </td>
                                        <td className="py-2 px-3 text-slate-200">
                                          {getScenarioLabel(r.scenario_id)}
                                        </td>
                                        <td className="py-2 px-3 text-slate-300">
                                          {getPolicyLabel(r.agent_type)}
                                        </td>
                                        <td className="py-2 px-3">
                                          {getVerdictBadge(r.grader_result.verdict)}
                                        </td>
                                        <td className="py-2 px-3 text-slate-400">
                                          {r.grader_result.faults_encountered > 0
                                            ? `${r.grader_result.faults_recovered} of ${r.grader_result.faults_encountered}`
                                            : '0 faults'}
                                        </td>
                                        <td className="py-2 px-3 text-slate-300">
                                          {r.grader_result.tool_calls}
                                        </td>
                                        <td className="py-2 px-3 text-right">
                                          <Link
                                            to={`/trace?runId=${r.id}`}
                                            className="text-indigo-400 hover:text-indigo-300 hover:underline text-xs font-medium"
                                          >
                                            Inspect trace
                                          </Link>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Clock className="w-8 h-8 text-slate-600" />
                        <span className="font-medium text-slate-300">No runs yet</span>
                        <span className="text-xs text-slate-500">
                          No matrix evaluation batches recorded. Launch a Full Matrix in Run Lab.
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            /* Single tests view OR All view */
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Run ID</th>
                  {viewMode === 'all' && <th className="py-2.5 px-3">Type</th>}
                  <th className="py-2.5 px-3">Scenario</th>
                  <th className="py-2.5 px-3">Policy</th>
                  <th className="py-2.5 px-3">Verdict</th>
                  <th className="py-2.5 px-3">Faults recovered</th>
                  <th className="py-2.5 px-3">Tool calls</th>
                  <th className="py-2.5 px-3">Duration</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {runs && runs.length > 0 ? (
                  runs.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-2.5 px-3 text-indigo-300 font-medium">
                        {formatRunId(r.id)}
                      </td>
                      {viewMode === 'all' && (
                        <td className="py-2.5 px-3">
                          {r.batch_id ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-950/70 text-purple-300 border border-purple-800/60">
                              Matrix batch
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-950/70 text-indigo-300 border border-indigo-800/60">
                              Single test
                            </span>
                          )}
                        </td>
                      )}
                      <td className="py-2.5 px-3 text-slate-200">
                        {getScenarioLabel(r.scenario_id)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        {getPolicyLabel(r.agent_type)}
                      </td>
                      <td className="py-2.5 px-3">{getVerdictBadge(r.grader_result.verdict)}</td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {r.grader_result.faults_encountered > 0
                          ? `${r.grader_result.faults_recovered} of ${r.grader_result.faults_encountered}`
                          : '0 faults'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">{r.grader_result.tool_calls}</td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {r.metrics.execution_time_ms} ms
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Link
                          to={`/trace?runId=${r.id}`}
                          className="text-indigo-400 hover:text-indigo-300 hover:underline text-xs font-medium"
                        >
                          Inspect trace
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={viewMode === 'all' ? 9 : 8}
                      className="py-8 text-center text-slate-400"
                    >
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Clock className="w-8 h-8 text-slate-600" />
                        <span className="font-medium text-slate-300">No runs yet</span>
                        <span className="text-xs text-slate-500">
                          {viewMode === 'single'
                            ? 'No single test runs recorded. Launch a test in Run Lab.'
                            : 'Head over to the Run Lab to launch an experiment.'}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
