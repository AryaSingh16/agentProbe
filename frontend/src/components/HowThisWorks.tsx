import React, { useState } from 'react';
import { ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';

export const HowThisWorks: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between text-left text-slate-300 hover:text-white hover:bg-slate-800/40 transition"
      >
        <span className="flex items-center gap-2 font-medium">
          <HelpCircle className="w-4 h-4 text-indigo-400" />
          <span>How this works</span>
        </span>
        {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 pt-1 text-slate-300 border-t border-slate-800/60 leading-relaxed">
          <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
            <li>
              <strong className="text-white">Run a single test:</strong> Select an agent and inject a fault to see how it handles failure.
            </li>
            <li>
              <strong className="text-white">Run Full Matrix:</strong> Evaluate resilience across all scenarios and fault types.
            </li>
            <li>
              <strong className="text-white">Inspect failures:</strong> Review step-by-step traces and root cause diagnosis to understand breakdowns.
            </li>
            <li>
              <strong className="text-white">Auto-harden policies:</strong> Automatically patch agent safeguards, retry budgets, and validation rules, then run a verified re-test.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
};
