import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchMetrics, fetchRuns } from '../api';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Flame,
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
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from 'recharts';

export const Overview: React.FC = () => {
  const { data: metricsData, isLoading: metricsLoading, refetch: refetchMetrics } = useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 5000,
  });

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['recent-runs'],
    queryFn: () => fetchRuns(10, 0),
    refetchInterval: 5000,
  });

  const aggs = metricsData?.aggregates;
  const heatmap = metricsData?.reliability_matrix || {};

  // Compute baseline vs faulted chart data
  const baselineRuns = runs?.filter((r) => r.fault_schedule.length === 0) || [];
  const faultedRuns = runs?.filter((r) => r.fault_schedule.length > 0) || [];

  const baselinePassed = baselineRuns.filter((r) => r.grader_result.verdict === 'PASSED').length;
  const faultedPassed = faultedRuns.filter((r) => r.grader_result.verdict === 'PASSED').length;

  const chartData = [
    {
      name: 'Baseline (0 Faults)',
      successRate: baselineRuns.length > 0 ? Math.round((baselinePassed / baselineRuns.length) * 100) : 0,
      total: baselineRuns.length,
    },
    {
      name: 'Faulted Injections',
      successRate: faultedRuns.length > 0 ? Math.round((faultedPassed / faultedRuns.length) * 100) : 0,
      total: faultedRuns.length,
    },
  ];

  const getHeatmapColor = (val: number | null | undefined) => {
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

  const faultTypes = ['none', 'timeout', 'http_500', 'malformed_json', 'empty_response', 'transient_then_success'];

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="border border-indigo-900/40 bg-gradient-to-r from-indigo-950/30 via-slate-900 to-slate-900 rounded-xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-indigo-400 font-mono text-xs tracking-wider uppercase mb-1">
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Success Rate */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>TASK SUCCESS</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {aggs?.success_formatted && aggs.success_formatted !== 'N/A'
              ? aggs.success_formatted
              : aggs?.success_rate !== null && aggs?.success_rate !== undefined
              ? `${Math.round(aggs.success_rate * 100)}%`
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {aggs?.success_ci_95 ? `95% CI: [${Math.round(aggs.success_ci_95[0]*100)}%, ${Math.round(aggs.success_ci_95[1]*100)}%]` : 'Goal & assertion completion'}
          </div>
        </div>

        {/* Tool Error Rate */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>TOOL ERROR RATE</span>
            <Wrench className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {aggs?.tool_error_formatted && aggs.tool_error_formatted !== 'N/A'
              ? aggs.tool_error_formatted
              : aggs?.tool_error_rate !== null && aggs?.tool_error_rate !== undefined
              ? `${Math.round(aggs.tool_error_rate * 100)}%`
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {aggs?.tool_error_ci_95 ? `95% CI: [${Math.round(aggs.tool_error_ci_95[0]*100)}%, ${Math.round(aggs.tool_error_ci_95[1]*100)}%]` : 'Errors per tool call'}
          </div>
        </div>

        {/* Recovery Rate */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>FAULT RECOVERY</span>
            <Percent className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {aggs?.recovery_formatted && aggs.recovery_formatted !== 'N/A'
              ? aggs.recovery_formatted
              : aggs?.recovery_rate !== null && aggs?.recovery_rate !== undefined
              ? `${Math.round(aggs.recovery_rate * 100)}%`
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {aggs?.recovery_ci_95 ? `95% CI: [${Math.round(aggs.recovery_ci_95[0]*100)}%, ${Math.round(aggs.recovery_ci_95[1]*100)}%]` : 'Encountered faults recovered'}
          </div>
        </div>

        {/* Policy Violations */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>POLICY VIOLATIONS</span>
            <ShieldAlert className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {aggs?.policy_violation_formatted && aggs.policy_violation_formatted !== 'N/A'
              ? aggs.policy_violation_formatted
              : aggs?.policy_violation_rate !== null && aggs?.policy_violation_rate !== undefined
              ? `${Math.round(aggs.policy_violation_rate * 100)}%`
              : '0/0 (0.0%)'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {aggs?.policy_violation_ci_95 ? `95% CI: [${Math.round(aggs.policy_violation_ci_95[0]*100)}%, ${Math.round(aggs.policy_violation_ci_95[1]*100)}%]` : 'Runs triggering BLOCKED'}
          </div>
        </div>

        {/* Avg Tool Calls */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>AVG TOOL CALLS</span>
            <Layers className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {aggs?.avg_tool_calls !== null && aggs?.avg_tool_calls !== undefined
              ? aggs.avg_tool_calls
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Telemetry trajectory depth</div>
        </div>

        {/* Recovery Degradation */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>DEGRADATION</span>
            <Flame className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {aggs?.recovery_degradation !== null && aggs?.recovery_degradation !== undefined
              ? `${Math.round(aggs.recovery_degradation * 100)}%`
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Baseline minus faulted delta</div>
        </div>
      </div>

      {/* Main Grid: Heatmap + Comparison Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Reliability Matrix Heatmap (2 cols) */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" /> Reliability Matrix Heatmap
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Stress-test success rates with exact sample sizes (n) and 95% Wilson confidence intervals.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1 text-emerald-400"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-800 inline-block"></span> ≥80%</span>
              <span className="flex items-center gap-1 text-amber-400"><span className="w-2.5 h-2.5 rounded-sm bg-amber-800 inline-block"></span> 40-79%</span>
              <span className="flex items-center gap-1 text-rose-400"><span className="w-2.5 h-2.5 rounded-sm bg-rose-800 inline-block"></span> &lt;40%</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 font-semibold uppercase tracking-wider">Policy / Agent</th>
                  {faultTypes.map((ft) => (
                    <th key={ft} className="py-2.5 px-3 font-mono uppercase text-center">{ft}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {['naive', 'robust', 'llm'].map((agent) => {
                  const agentData = heatmap[agent] || {};
                  const agentDetails = metricsData?.reliability_matrix_details?.[agent] || {};
                  const agentLabel = agent === 'llm' ? 'LLM (recorded)' : agent;
                  const agentBadge = agent === 'llm' ? '(recorded model)' : '(simulated)';
                  return (
                    <tr key={agent} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-3 font-semibold text-slate-200 capitalize flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${agent === 'robust' ? 'bg-indigo-400' : agent === 'llm' ? 'bg-purple-400' : 'bg-amber-400'}`}></span>
                        {agentLabel}
                        <span className="text-[10px] text-slate-500 lowercase font-normal">{agentBadge}</span>
                      </td>
                      {faultTypes.map((ft) => {
                        const val = agentData[ft];
                        const detail = agentDetails[ft];
                        const displayVal = val !== undefined && val !== null ? `${Math.round(val * 100)}%` : 'N/A';
                        const ciTooltip = detail?.ci_lower !== null && detail?.ci_lower !== undefined
                          ? `Sample: ${detail.passed}/${detail.total} passed\n95% Wilson CI: [${(detail.ci_lower*100).toFixed(1)}%, ${(detail.ci_upper*100).toFixed(1)}%]`
                          : 'No runs recorded for this cell';
                        return (
                          <td key={ft} className="py-2 px-2 text-center">
                            <div
                              title={ciTooltip}
                              className={`py-1.5 px-2 rounded border text-xs font-bold flex flex-col items-center justify-center cursor-help ${getHeatmapColor(val)}`}
                            >
                              <span>{displayVal}</span>
                              {detail && detail.total > 0 && (
                                <span className="text-[10px] font-normal opacity-80">{detail.passed}/{detail.total}</span>
                              )}
                              {detail && detail.is_low_sample && detail.total > 0 && (
                                <span className="text-[8px] font-sans tracking-tight text-amber-300 bg-amber-950/80 px-1 rounded border border-amber-800/60 mt-0.5">
                                  low sample (n&lt;10)
                                </span>
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

          <div className="mt-4 p-3 rounded-lg bg-slate-950/70 border border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
            <strong className="text-slate-300 font-semibold">Metrics Note:</strong> Naive and Robust are author-written reference policies; this performance gap validates that the test harness reliably separates weak from hardened policies, and is not a discovery about AI agents in general.
          </div>
        </div>

        {/* Baseline vs Faulted Chart (1 col) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-emerald-400" /> Baseline vs Faulted
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Degradation comparison between pristine executions and active fault injection.
            </p>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#6b7280" fontSize={11} tickLine={false} />
                  <YAxis stroke="#6b7280" fontSize={11} domain={[0, 100]} unit="%" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(val: any) => [`${val}%`, 'Success Rate']}
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
            <span>Total Experiments Evaluated:</span>
            <span className="font-mono text-white font-bold">{aggs?.total_runs || 0}</span>
          </div>
        </div>
      </div>

      {/* Recent Runs Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" /> Recent Experiment Runs
            </h2>
            <p className="text-xs text-slate-400">
              Deterministic runs with trace recordings and automated grading assertions.
            </p>
          </div>
          <Link to="/trace" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1">
            View All Traces <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2.5 px-3">Run ID</th>
                <th className="py-2.5 px-3">Scenario</th>
                <th className="py-2.5 px-3">Agent</th>
                <th className="py-2.5 px-3">Verdict</th>
                <th className="py-2.5 px-3">Faults (Enc/Rec)</th>
                <th className="py-2.5 px-3">Tool Calls</th>
                <th className="py-2.5 px-3">Duration</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {runs && runs.length > 0 ? (
                runs.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-2.5 px-3 text-indigo-300 font-bold">{r.id}</td>
                    <td className="py-2.5 px-3 text-slate-200">{r.scenario_id}</td>
                    <td className="py-2.5 px-3 text-slate-300 capitalize">{r.agent_type}</td>
                    <td className="py-2.5 px-3">{getVerdictBadge(r.grader_result.verdict)}</td>
                    <td className="py-2.5 px-3 text-slate-400">
                      {r.grader_result.faults_encountered} / {r.grader_result.faults_recovered}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">{r.grader_result.tool_calls}</td>
                    <td className="py-2.5 px-3 text-slate-400">{r.metrics.execution_time_ms} ms</td>
                    <td className="py-2.5 px-3 text-right">
                      <Link
                        to={`/trace?runId=${r.id}`}
                        className="text-indigo-400 hover:text-indigo-300 hover:underline font-sans text-xs"
                      >
                        Inspect Trace
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500 font-sans">
                    No runs recorded yet. Head over to the Run Lab to launch an experiment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
