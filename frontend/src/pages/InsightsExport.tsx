import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clearHistory, generateSimulatorRuns, predictRisk, trainPredictor } from '../api';
import {
  PolicyConfig,
  PredictorPredictResponse,
  PredictorTrainResponse,
} from '../types';
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Database,
  Download,
  FileCode,
  FileText,
  HelpCircle,
  PlusCircle,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react';

export const InsightsExport: React.FC = () => {
  const queryClient = useQueryClient();

  // Predictor form state
  const [scenarioId, setScenarioId] = useState<string>('bad_deploy');
  const [faultType, setFaultType] = useState<string>('timeout');
  const [faultIntensity, setFaultIntensity] = useState<number>(2);
  const [policy, setPolicy] = useState<PolicyConfig>({
    max_retries: 0,
    validate_schema: false,
    treat_output_as_data: false,
    verify_postconditions: false,
  });

  const [prediction, setPrediction] = useState<PredictorPredictResponse | null>(null);
  const [trainStats, setTrainStats] = useState<PredictorTrainResponse | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState<boolean>(false);
  const [clearInput, setClearInput] = useState<string>('');

  // Markdown Report Preview Query
  const { data: reportPreview, refetch: refetchReport } = useQuery({
    queryKey: ['report-preview'],
    queryFn: async () => {
      const res = await fetch('/api/export/report.md');
      return res.text();
    },
  });

  // Predict Mutation
  const predictMutation = useMutation({
    mutationFn: () =>
      predictRisk({
        scenario_id: scenarioId,
        policy,
        fault_type: faultType === 'none' ? null : faultType,
        fault_intensity: faultType === 'none' ? 0 : faultIntensity,
      }),
    onSuccess: (data) => setPrediction(data),
  });

  // Train Mutation
  const trainMutation = useMutation({
    mutationFn: trainPredictor,
    onSuccess: (data) => setTrainStats(data),
  });

  // Generate Real Simulator Runs Mutation
  const generateRunsMutation = useMutation({
    mutationFn: () => generateSimulatorRuns(50),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recent-runs'] });
      queryClient.invalidateQueries({ queryKey: ['runs-list'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      refetchReport();
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

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="border border-indigo-900/40 bg-gradient-to-r from-slate-900 via-indigo-950/20 to-slate-900 rounded-xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-indigo-400 font-mono text-xs tracking-wider uppercase mb-1">
          <Brain className="w-4 h-4" /> Machine Learning & Reporting
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Insights, Predictor & Data Pipelines</h1>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">
          Pre-deployment failure risk prediction, audited Markdown stress-test reports, and exported datasets for optional LoRA workflow (not executed).
        </p>
      </div>

      {/* Grid: Predictor (left) & Exports (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Learned Failure-Risk Predictor */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-400" /> Learned Failure-Risk Predictor
              </h2>
              <p className="text-xs text-slate-400">
                scikit-learn classifier trained strictly on real stored runs (zero synthetic data).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => generateRunsMutation.mutate()}
                disabled={generateRunsMutation.isPending}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded text-xs font-medium flex items-center gap-1.5 border border-slate-700"
                title="Generates 50 real seeded simulator runs"
              >
                <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
                {generateRunsMutation.isPending ? 'Simulating...' : 'Generate Real Runs (+50)'}
              </button>
              <button
                onClick={() => trainMutation.mutate()}
                disabled={trainMutation.isPending}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-xs font-medium flex items-center gap-1.5 shadow"
              >
                <Sparkles className="w-3.5 h-3.5 text-white" />
                {trainMutation.isPending ? 'Training...' : 'Train on Real Runs'}
              </button>
            </div>
          </div>

          {/* Model Status & Small-Data Handling */}
          {trainStats ? (
            <>
              {trainStats.is_insufficient_data ? (
                <div className="p-3 bg-rose-950/30 border border-rose-800 rounded-lg text-xs text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold uppercase tracking-wider text-rose-200">
                      Insufficient data: metrics are not meaningful
                    </div>
                    <div className="text-[11px] text-rose-300/90 mt-0.5">
                      Sample size n = {trainStats.sample_size} runs is below the required 200-run threshold. Trained strictly on real stored runs (zero synthetic rows). Accuracy and ROC AUC are greyed out to prevent false confidence.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-950/20 border border-emerald-800/60 rounded-lg text-xs text-emerald-300 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Trained on real stored runs:</span> n = {trainStats.sample_size} runs (meets &ge; 200 threshold). Grouped leakage-safe split verified.
                  </div>
                </div>
              )}

              {/* Model Holdout Stats with greyed-out state if insufficient data */}
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 grid grid-cols-3 gap-2 text-xs text-center font-mono">
                <div>
                  <span className="text-slate-500 text-[10px] uppercase">Accuracy:</span>
                  {trainStats.is_insufficient_data ? (
                    <div>
                      <div className="text-slate-600 line-through">{Math.round(trainStats.accuracy * 100)}%</div>
                      <div className="text-[9px] text-rose-400 uppercase font-sans">Greyed out (n &lt; 200)</div>
                    </div>
                  ) : (
                    <div className="text-emerald-400 font-bold">{Math.round(trainStats.accuracy * 100)}%</div>
                  )}
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] uppercase">ROC AUC:</span>
                  {trainStats.is_insufficient_data ? (
                    <div>
                      <div className="text-slate-600 line-through">{trainStats.auc !== null ? trainStats.auc : 'N/A'}</div>
                      <div className="text-[9px] text-rose-400 uppercase font-sans">Greyed out (n &lt; 200)</div>
                    </div>
                  ) : (
                    <div className="text-indigo-400 font-bold">{trainStats.auc !== null ? trainStats.auc : 'N/A'}</div>
                  )}
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] uppercase">Sample Size:</span>
                  <div className="text-slate-200 font-bold">{trainStats.sample_size} runs</div>
                  <div className="text-[9px] text-slate-400 uppercase font-sans">Real runs only</div>
                </div>
              </div>

              {/* Class balance and majority baseline comparison */}
              <div className="p-2.5 bg-slate-950/80 rounded-lg border border-slate-800/80 text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span>Class Balance:</span>
                  <span className="font-mono text-slate-300">
                    Failed: {trainStats.class_balance?.failed ?? 0} | Passed: {trainStats.class_balance?.passed ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span>Majority-Class Baseline:</span>
                  <span className="font-mono text-slate-300">
                    {Math.round((trainStats.majority_class_baseline_accuracy ?? 0) * 100)}%
                  </span>
                </div>
                <div className="text-[11px] pt-1 border-t border-slate-800/60 font-medium">
                  {trainStats.beats_baseline === false ? (
                    <span className="text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Model does not beat majority-class baseline.
                    </span>
                  ) : trainStats.beats_baseline === true ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Model beats majority-class baseline.
                    </span>
                  ) : (
                    <span className="text-slate-400">{trainStats.baseline_comparison || 'No baseline comparison available.'}</span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg text-xs text-slate-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-300">Real Stored Runs Training:</span> Zero synthetic permutations.
                Requires &ge; 200 real runs for meaningful metrics. Click <em>Generate Real Runs</em> to run simulations, then <em>Train on Real Runs</em>.
              </div>
            </div>
          )}

          {/* Predict Form */}
          <div className="space-y-3 pt-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1">Scenario Target:</label>
                <select
                  value={scenarioId}
                  onChange={(e) => setScenarioId(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200"
                >
                  <option value="healthy_service">healthy_service</option>
                  <option value="bad_deploy">bad_deploy</option>
                  <option value="rollback_denied">rollback_denied</option>
                  <option value="unfixable_rollback">unfixable_rollback</option>
                  <option value="injected_instruction">injected_instruction</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Fault Type:</label>
                <select
                  value={faultType}
                  onChange={(e) => setFaultType(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono"
                >
                  <option value="none">none</option>
                  <option value="timeout">timeout</option>
                  <option value="http_500">http_500</option>
                  <option value="malformed_json">malformed_json</option>
                  <option value="empty_response">empty_response</option>
                  <option value="transient_then_success">transient_then_success</option>
                </select>
              </div>
            </div>

            {/* Policy Checkboxes */}
            <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-2">
              <div className="font-semibold text-slate-400 uppercase text-[10px]">Proposed Policy Guardrails:</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Retries:</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={policy.max_retries}
                    onChange={(e) => setPolicy({ ...policy, max_retries: parseInt(e.target.value) || 0 })}
                    className="w-14 px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-center text-white font-mono"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-slate-300">
                  <input
                    type="checkbox"
                    checked={policy.validate_schema}
                    onChange={(e) => setPolicy({ ...policy, validate_schema: e.target.checked })}
                    className="rounded bg-slate-900 border-slate-700 text-indigo-600"
                  />
                  <span>Schema Check</span>
                </label>
                <label className="flex items-center gap-1.5 text-slate-300">
                  <input
                    type="checkbox"
                    checked={policy.treat_output_as_data}
                    onChange={(e) => setPolicy({ ...policy, treat_output_as_data: e.target.checked })}
                    className="rounded bg-slate-900 border-slate-700 text-indigo-600"
                  />
                  <span>Data/Prompt Isolate</span>
                </label>
                <label className="flex items-center gap-1.5 text-slate-300">
                  <input
                    type="checkbox"
                    checked={policy.verify_postconditions}
                    onChange={(e) => setPolicy({ ...policy, verify_postconditions: e.target.checked })}
                    className="rounded bg-slate-900 border-slate-700 text-indigo-600"
                  />
                  <span>Verify Recovery</span>
                </label>
              </div>
            </div>

            <button
              onClick={() => predictMutation.mutate()}
              disabled={predictMutation.isPending}
              className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition"
            >
              {predictMutation.isPending ? 'Calculating Probability...' : 'Predict Failure Risk'}
            </button>
          </div>

          {/* Prediction Output */}
          {prediction && (
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Estimated Failure Risk:</span>
                <span
                  className={`px-2.5 py-0.5 rounded text-xs font-bold font-mono ${
                    prediction.risk_level === 'LOW'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : prediction.risk_level === 'MEDIUM'
                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {prediction.risk_level} ({Math.round(prediction.failure_risk_probability * 100)}%)
                </span>
              </div>

              {/* Probability bar */}
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    prediction.failure_risk_probability > 0.7
                      ? 'bg-rose-500'
                      : prediction.failure_risk_probability > 0.35
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.round(prediction.failure_risk_probability * 100)}%` }}
                ></div>
              </div>

              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase">Key Contributing Factors:</span>
                <ul className="text-xs space-y-1 mt-1 text-slate-300">
                  {prediction.contributing_factors.map((f, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span className="text-indigo-400">•</span> {f}
                    </li>
                  ))}
                </ul>
              </div>
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
              Download audited datasets and reports. Fine-tune exports strictly strip secrets and exclude prompt injections.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <a
                href="/api/export/runs.json"
                download="agentprobe_runs.json"
                className="p-3 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg text-center transition flex flex-col items-center gap-2"
              >
                <FileCode className="w-5 h-5 text-indigo-400" />
                <span className="text-xs font-semibold text-white">Runs JSON</span>
                <span className="text-[10px] text-slate-400">Full telemetry archive</span>
              </a>

              <a
                href="/api/export/report.md"
                download="agentprobe_report.md"
                className="p-3 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg text-center transition flex flex-col items-center gap-2"
              >
                <FileText className="w-5 h-5 text-emerald-400" />
                <span className="text-xs font-semibold text-white">Report (MD)</span>
                <span className="text-[10px] text-slate-400">Executive summary</span>
              </a>

              <a
                href="/api/export/finetune.jsonl"
                download="finetune.jsonl"
                className="p-3 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg text-center transition flex flex-col items-center gap-2"
              >
                <Database className="w-5 h-5 text-purple-400" />
                <span className="text-xs font-semibold text-white">Export (JSONL)</span>
                <span className="text-[10px] text-slate-400">Optional LoRA workflow (not executed)</span>
              </a>
            </div>
          </div>

          {/* Clear Run History Card */}
          <div className="bg-slate-900/90 border border-rose-950/60 rounded-xl p-6 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-400" /> Reset & Clear History
            </h2>
            <p className="text-xs text-slate-400">
              Permanently purges all stored run records and matrix job caches from SQLite database.
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
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-400" /> Executive Report Preview (Markdown)
          </h2>
          <span className="text-xs text-slate-500 font-mono">GET /api/export/report.md</span>
        </div>
        <pre className="p-4 bg-slate-950 rounded-lg border border-slate-800 text-slate-300 font-mono text-xs max-h-96 overflow-y-auto whitespace-pre-wrap">
          {reportPreview || 'No runs to summarize yet.'}
        </pre>
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
