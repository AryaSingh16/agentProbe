import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clearHistory, predictRisk } from '../api';
import {
  PolicyConfig,
  PredictorPredictResponse,
} from '../types';
import {
  getFaultLabel,
  getScenarioLabel,
} from '../lib/labels';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Database,
  Download,
  FileCode,
  FileText,
  Info,
  Sliders,
  Trash2,
  TrendingUp,
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

export const InsightsExport: React.FC = () => {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split('T')[0];

  // What-if Risk Estimator state
  const [scenarioId, setScenarioId] = useState<string>('bad_deploy');
  const [faultType, setFaultType] = useState<string>('timeout');
  const [faultIntensity, setFaultIntensity] = useState<number>(2);
  const [policy, setPolicy] = useState<PolicyConfig>({
    max_retries: 0,
    validate_schema: false,
    treat_output_as_data: false,
    verify_postconditions: false,
  });

  const [confirmClearOpen, setConfirmClearOpen] = useState<boolean>(false);
  const [clearInput, setClearInput] = useState<string>('');

  // What-if Risk Estimator Query keyed by all input parameters (prevents stale state):
  const riskEstimateQuery = useQuery({
    queryKey: [
      'risk-estimate',
      scenarioId,
      faultType,
      faultIntensity,
      policy.max_retries,
      policy.validate_schema,
      policy.treat_output_as_data,
      policy.verify_postconditions,
    ],
    queryFn: () =>
      predictRisk({
        scenario_id: scenarioId,
        policy,
        fault_type: faultType === 'none' ? null : faultType,
        fault_intensity: faultType === 'none' ? 0 : faultIntensity,
      }),
  });

  const prediction = riskEstimateQuery.data ?? null;

  // Markdown Report Preview Query
  const { data: reportPreview, refetch: refetchReport } = useQuery({
    queryKey: ['report-preview'],
    queryFn: async () => {
      const res = await fetch('/api/export/report.md');
      return res.text();
    },
  });

  // Clear Mutation
  const clearMutation = useMutation({
    mutationFn: clearHistory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recent-runs'] });
      queryClient.invalidateQueries({ queryKey: ['runs-list'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      setConfirmClearOpen(false);
      setClearInput('');
      refetchReport();
    },
  });

  const getRiskLevelColor = (level?: string) => {
    switch (level) {
      case 'LOW':
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-800';
      case 'MEDIUM':
        return 'text-amber-400 bg-amber-950/60 border-amber-800';
      default:
        return 'text-rose-400 bg-rose-950/60 border-rose-800';
    }
  };

  const perFaultData = prediction?.per_fault_risks
    ? Object.entries(prediction.per_fault_risks).map(([ft, r]) => ({
        fault: getFaultLabel(ft),
        risk: Math.round(r * 100),
      }))
    : [];

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="border border-indigo-900/40 bg-gradient-to-r from-slate-900 via-indigo-950/20 to-slate-900 rounded-xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-indigo-400 text-xs tracking-wider uppercase mb-1 font-semibold">
          <Brain className="w-4 h-4" /> Machine Learning & Reporting
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Insights, Predictor & Data Pipelines</h1>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">
          Pre-deployment failure risk prediction, audited Markdown stress-test reports, and exported datasets for optional fine-tuning workflows.
        </p>
      </div>

      {/* Grid: What-if Estimator (left) & Exports (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* What-if Risk Estimator */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-400" /> What-if Risk Estimator
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Evaluates failure risk across configurations with scenario holdout cross-validation and live 10-seed simulation checks.
              </p>
            </div>
          </div>

          {/* Configuration Form */}
          <div className="space-y-4 pt-1 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1 font-medium">Incident scenario:</label>
                <select
                  value={scenarioId}
                  onChange={(e) => setScenarioId(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200"
                >
                  <option value="healthy_service">{getScenarioLabel('healthy_service')}</option>
                  <option value="bad_deploy">{getScenarioLabel('bad_deploy')}</option>
                  <option value="rollback_denied">{getScenarioLabel('rollback_denied')}</option>
                  <option value="unfixable_rollback">{getScenarioLabel('unfixable_rollback')}</option>
                  <option value="injected_instruction">{getScenarioLabel('injected_instruction')}</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-medium">Fault injection:</label>
                <select
                  value={faultType}
                  onChange={(e) => setFaultType(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200"
                >
                  <option value="none">{getFaultLabel('none')}</option>
                  <option value="timeout">{getFaultLabel('timeout')}</option>
                  <option value="http_500">{getFaultLabel('http_500')}</option>
                  <option value="malformed_json">{getFaultLabel('malformed_json')}</option>
                  <option value="empty_response">{getFaultLabel('empty_response')}</option>
                  <option value="transient_then_success">{getFaultLabel('transient_then_success')}</option>
                </select>
              </div>
            </div>

            {faultType !== 'none' && (
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Fault intensity:</span>
                  <span className="text-white font-bold">{faultIntensity}</span>
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

            {/* Policy Guardrails */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-slate-400 block font-medium">Candidate policy guardrails:</span>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policy.max_retries > 0}
                    onChange={(e) => setPolicy({ ...policy, max_retries: e.target.checked ? 3 : 0 })}
                    className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>Retry transient errors (3x)</span>
                </label>

                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policy.validate_schema}
                    onChange={(e) => setPolicy({ ...policy, validate_schema: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>Validate data schemas</span>
                </label>

                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policy.treat_output_as_data}
                    onChange={(e) => setPolicy({ ...policy, treat_output_as_data: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>Isolate prompt instructions</span>
                </label>

                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policy.verify_postconditions}
                    onChange={(e) => setPolicy({ ...policy, verify_postconditions: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>Verify recovery postcondition</span>
                </label>
              </div>
            </div>

            <button
              onClick={() => riskEstimateQuery.refetch()}
              disabled={riskEstimateQuery.isFetching}
              className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition"
            >
              <TrendingUp className="w-4 h-4" />
              {riskEstimateQuery.isFetching ? 'Calculating risk...' : 'Estimate failure risk'}
            </button>
          </div>

          {/* Prediction Output */}
          {prediction && (
            <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-4">
              {/* Side-by-side: Model Estimate vs Simulated Check */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                  <div className="text-[10px] uppercase text-slate-400 font-semibold mb-1">
                    Model estimate
                  </div>
                  <div className="text-xl font-bold text-white">
                    {Math.round((prediction.model_estimate_probability ?? prediction.failure_risk_probability) * 100)}%
                  </div>
                  <div className="mt-1">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${getRiskLevelColor(prediction.model_risk_level ?? prediction.risk_level)}`}>
                      {(prediction.model_risk_level ?? prediction.risk_level)} RISK
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                  <div className="text-[10px] uppercase text-slate-400 font-semibold mb-1">
                    Simulated check (10 runs)
                  </div>
                  <div className="text-xl font-bold text-white">
                    {prediction.simulated_check_formatted ?? 'N/A'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {prediction.simulated_check_failures !== undefined
                      ? `${prediction.simulated_check_failures} failures in ${prediction.simulated_check_total || 10} seeds`
                      : 'Live verification'}
                  </div>
                </div>
              </div>

              {/* Disagreement Callout */}
              {prediction.disagreement && (
                <div className="p-2.5 rounded bg-amber-950/40 border border-amber-800 text-amber-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>Model estimate and simulated check show differing risk levels.</span>
                </div>
              )}

              {/* Risk Level Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Risk spectrum:</span>
                  <span className="text-white font-medium">
                    {Math.round((prediction.model_estimate_probability ?? prediction.failure_risk_probability) * 100)}%
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      (prediction.model_estimate_probability ?? prediction.failure_risk_probability) > 0.7
                        ? 'bg-rose-500'
                        : (prediction.model_estimate_probability ?? prediction.failure_risk_probability) >= 0.35
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.round((prediction.model_estimate_probability ?? prediction.failure_risk_probability) * 100)}%` }}
                  ></div>
                </div>
              </div>

              {/* Per-Fault Risk Chart */}
              {perFaultData.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase">
                    Risk across fault categories
                  </span>
                  <div className="h-40 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={perFaultData} margin={{ top: 5, right: 10, left: -20, bottom: 25 }}>
                        <XAxis
                          dataKey="fault"
                          stroke="#94a3b8"
                          fontSize={9}
                          tickLine={false}
                          angle={-20}
                          textAnchor="end"
                          interval={0}
                        />
                        <YAxis stroke="#94a3b8" fontSize={10} domain={[0, 100]} unit="%" />
                        <RechartsTooltip
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }}
                          formatter={(val: any) => [`${val}%`, 'Failure risk']}
                        />
                        <Bar dataKey="risk" radius={[3, 3, 0, 0]}>
                          {perFaultData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.risk > 70 ? '#ef4444' : entry.risk >= 35 ? '#f59e0b' : '#10b981'}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Contributing Factors */}
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase">Key contributing factors:</span>
                <ul className="text-xs space-y-1 mt-1 text-slate-300">
                  {prediction.contributing_factors.map((f, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span className="text-indigo-400">•</span> {f}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Statistical Note */}
              <div className="text-[11px] text-slate-400 p-2.5 rounded bg-slate-900 border border-slate-800 leading-relaxed">
                <span className="font-semibold text-slate-300">Methodology:</span>{' '}
                {prediction.note || 'Estimates pre-deployment failure risk using regularized linear modeling across unique configurations with scenario holdout cross-validation, verified by a live 10-seed empirical simulation check.'}
              </div>

              {/* Collapsed Technical Details */}
              <details data-technical-details="true" className="text-[11px]">
                <summary className="text-slate-500 cursor-pointer hover:text-slate-300">Technical details</summary>
                <pre className="p-2 mt-1 rounded bg-slate-900 border border-slate-800 text-slate-400 overflow-x-auto">
                  {JSON.stringify({
                    model_estimate: prediction.model_estimate_probability,
                    simulated_check: prediction.simulated_check_formatted,
                    disagreement: prediction.disagreement,
                    configurations_count: prediction.unique_configurations_count,
                    leave_one_scenario_out_accuracy: prediction.leave_one_scenario_out_accuracy,
                  }, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>

        {/* Data Pipelines & Exports */}
        <div className="space-y-6">
          {/* Download Cards */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Download className="w-4 h-4 text-emerald-400" /> Export Data Pipelines
            </h2>
            <p className="text-xs text-slate-400">
              Download audited datasets and reports. Fine-tune exports strip internal credentials and exclude prompt injections.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <a
                href="/api/export/report.md"
                download={`agentprobe-report-${today}.md`}
                className="p-3 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg text-center transition flex flex-col items-center gap-2"
              >
                <FileText className="w-5 h-5 text-emerald-400" />
                <span className="text-xs font-semibold text-white">Download report (.md)</span>
                <span className="text-[10px] text-slate-400">Executive summary</span>
              </a>

              <a
                href="/api/export/runs.json"
                download={`agentprobe-runs-${today}.json`}
                className="p-3 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg text-center transition flex flex-col items-center gap-2"
              >
                <FileCode className="w-5 h-5 text-indigo-400" />
                <span className="text-xs font-semibold text-white">Download data (.json)</span>
                <span className="text-[10px] text-slate-400">Full telemetry archive</span>
              </a>

              <a
                href="/api/export/finetune.jsonl"
                download={`agentprobe-finetune-${today}.jsonl`}
                className="p-3 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg text-center transition flex flex-col items-center gap-2"
              >
                <Database className="w-5 h-5 text-purple-400" />
                <span className="text-xs font-semibold text-white">Download training data (.jsonl)</span>
                <span className="text-[10px] text-slate-400">Supervised fine-tuning pairs</span>
              </a>
            </div>
          </div>

          {/* Clear Run History Card */}
          <div className="bg-slate-900/90 border border-rose-950/60 rounded-xl p-6 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-400" /> Reset & Clear History
            </h2>
            <p className="text-xs text-slate-400">
              Permanently purges all stored run records and matrix caches from database.
            </p>

            <button
              onClick={() => setConfirmClearOpen(true)}
              className="py-2 px-4 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-200 rounded-lg text-xs font-semibold flex items-center gap-2 transition"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear All Run History
            </button>
          </div>
        </div>
      </div>

      {/* Report Markdown Preview */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-400" /> Report preview
          </h2>
          <span className="text-xs text-slate-400">Formatted executive summary</span>
        </div>
        <div className="p-5 bg-slate-950 rounded-lg border border-slate-800 text-slate-300 text-xs max-h-96 overflow-y-auto">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="text-lg font-bold text-white mt-4 mb-2 pb-1 border-b border-slate-800">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-semibold text-slate-100 mt-4 mb-2">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-200 mt-3 mb-1">{children}</h3>,
              p: ({ children }) => <p className="my-1.5 leading-relaxed text-slate-300">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
              li: ({ children }) => <li className="text-slate-300 leading-relaxed">{children}</li>,
              table: ({ children }) => (
                <div className="overflow-x-auto my-3">
                  <table className="w-full text-xs text-left border-collapse border border-slate-800">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-slate-900 border-b border-slate-800 text-slate-200">{children}</thead>,
              tbody: ({ children }) => <tbody className="divide-y divide-slate-800/80">{children}</tbody>,
              tr: ({ children }) => <tr className="hover:bg-slate-900/40">{children}</tr>,
              th: ({ children }) => <th className="py-2 px-3 font-semibold text-slate-300">{children}</th>,
              td: ({ children }) => <td className="py-2 px-3 text-slate-300">{children}</td>,
              code: ({ children }) => (
                <code className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-200 font-mono text-[11px]">
                  {children}
                </code>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-indigo-500 pl-3 my-2 italic text-slate-400">{children}</blockquote>
              ),
            }}
          >
            {reportPreview || 'No runs to summarize yet.'}
          </ReactMarkdown>
        </div>
      </div>

      {/* Confirmation Modal for Clearing History */}
      {confirmClearOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-bold text-white text-base">Confirm History Purge</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              This action will permanently delete all runs and matrix results from the database. Type <strong className="text-white font-mono">CONFIRM</strong> below to proceed:
            </p>
            <input
              type="text"
              placeholder="CONFIRM"
              value={clearInput}
              onChange={(e) => setClearInput(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-xs font-mono"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmClearOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs"
              >
                Cancel
              </button>
              <button
                onClick={() => clearMutation.mutate()}
                disabled={clearInput !== 'CONFIRM' || clearMutation.isPending}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white rounded text-xs font-semibold"
              >
                {clearMutation.isPending ? 'Clearing...' : 'Confirm Purge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
