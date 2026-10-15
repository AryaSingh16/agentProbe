import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Overview } from './pages/Overview';
import { RunLab } from './pages/RunLab';
import { TraceDiagnosis } from './pages/TraceDiagnosis';
import { InsightsExport } from './pages/InsightsExport';
import {
  Activity,
  AlertOctagon,
  Bot,
  Brain,
  Cpu,
  Layers,
  Radio,
  Sliders,
  Terminal,
} from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
                      AgentProbe <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-400 border border-indigo-800">v1.0</span>
                    </span>
                    <span className="block text-[10px] text-slate-400 font-medium">Fault Injection & Policy Hardening</span>
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

              {/* Status Indicator */}
              <div className="hidden lg:flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded-full border border-slate-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>API:8000 (REPLAY)</span>
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
            <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
              <span>AgentProbe — Open-source AI Agent Stress-Testing & Auto-Hardening Platform</span>
              <span className="font-mono text-[11px] text-slate-600">Simulated ops environment • Zero external API keys required</span>
            </div>
          </footer>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
};
