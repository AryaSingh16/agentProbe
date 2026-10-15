import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Overview } from './pages/Overview';
import { RunLab } from './pages/RunLab';
import { TraceDiagnosis } from './pages/TraceDiagnosis';
import { InsightsExport } from './pages/InsightsExport';
import { fetchHealth } from './api';
import {
  Activity,
  AlertOctagon,
  Brain,
  Info,
  Sliders,
  Terminal,
  X,
} from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const HeaderStatusPill: React.FC = () => {
  const { data: health, isError, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div
        title="Checking connection to test environment..."
        className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950 px-3 py-1 rounded-full border border-slate-800 cursor-help"
      >
        <span className="w-2 h-2 rounded-full bg-slate-500 animate-pulse"></span>
        <span>Connecting</span>
      </div>
    );
  }

  if (isError || !health) {
    return (
      <div
        title="The API service is unreachable."
        className="flex items-center gap-2 text-xs text-amber-300 bg-amber-950/40 px-3 py-1 rounded-full border border-amber-800/60 cursor-help"
      >
        <span className="w-2 h-2 rounded-full bg-amber-400"></span>
        <span>Offline</span>
      </div>
    );
  }

  const isLive = health.llm_mode === 'live';
  const label = isLive ? 'Live model' : 'Demo mode';
  const tooltip = isLive
    ? 'Connected to live language model in a simulated test environment.'
    : 'Replaying recorded agent runs in an isolated simulated environment.';

  return (
    <div
      title={tooltip}
      className="flex items-center gap-2 text-xs text-slate-300 bg-slate-950 px-3 py-1 rounded-full border border-slate-800 hover:border-slate-700 transition cursor-help"
    >
      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
      <span className="font-medium">{label}</span>
    </div>
  );
};

export const AppContent: React.FC = () => {
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-sans">
      {/* Top Enterprise Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
                <AlertOctagon className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                  AgentProbe
                </span>
                <span className="block text-[10px] text-slate-400 font-medium">
                  Fault Injection & Policy Hardening
                </span>
              </div>
            </Link>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 sm:gap-2">
            <NavLink
              to="/"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-700/60'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`
              }
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Overview</span>
            </NavLink>

            <NavLink
              to="/lab"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-700/60'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`
              }
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Run Lab</span>
            </NavLink>

            <NavLink
              to="/trace"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-700/60'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`
              }
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Trace & Diagnosis</span>
            </NavLink>

            <NavLink
              to="/insights"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-700/60'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`
              }
            >
              <Brain className="w-3.5 h-3.5" />
              <span>Insights & Export</span>
            </NavLink>
          </nav>

          {/* Right Controls: Status Indicator & About */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAboutOpen(true)}
              title="About AgentProbe"
              className="text-xs text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800/80 flex items-center gap-1 transition"
            >
              <Info className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">About</span>
            </button>
            <HeaderStatusPill />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/lab" element={<RunLab />} />
          <Route path="/trace" element={<TraceDiagnosis />} />
          <Route path="/insights" element={<InsightsExport />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-center">
          <span>AgentProbe</span>
        </div>
      </footer>

      {/* About Modal */}
      {aboutOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <AlertOctagon className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-white text-base">About AgentProbe</h3>
              </div>
              <button
                onClick={() => setAboutOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              AgentProbe is an open platform that stress-tests tool-using AI agents with controlled fault injection, finds the minimal set of faults that breaks an agent, and measures policy hardening.
            </p>
            <div className="p-3 bg-indigo-950/40 border border-indigo-800/60 rounded-lg text-xs text-indigo-200">
              All results come from a simulated environment and say nothing about production safety.
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setAboutOpen(false)}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold"
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

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </QueryClientProvider>
  );
};
