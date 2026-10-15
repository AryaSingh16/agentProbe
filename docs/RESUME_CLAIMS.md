# AgentProbe Resume Claims & Interview Guide 🎯

This document defines the exact, verified claims, interview talking points, and boundaries for discussing **AgentProbe**. Every figure in this document comes strictly from actual test runs executed in this repository.

---

## 1. Resume Bullets

### 1-Line Bullet:
> Built an automated AI agent stress-testing platform with controlled fault injection, `ddmin` minimal breaking fault isolation ($\le 20$ reruns), auto-policy hardening with measured counterfactual verification, and deterministic Wilson 95% confidence intervals.

### 2-Line Bullet:
> Engineered full-stack AI agent reliability harness (FastAPI, React 18, SQLite) evaluating agents across 5 ops scenarios and 5 fault modes with sample-size ($n$) reporting and Wilson 95% CIs; automated minimal fault isolation via delta debugging (`ddmin`) and measured counterfactual policy re-runs, backed by 37 unit/integration tests and real Google Gemini recorded replay cassettes.

---

## 2. Five Interview Talking Points

### Point 1: Harness Sensitivity & Reference Policies
- **The Question / Hook**: *"How do you evaluate whether an AI agent is actually robust against tool and infrastructure failures?"*
- **What AgentProbe Does**: AgentProbe tests agents against deterministic fault schedules (timeouts, HTTP 500s, malformed JSON, empty responses, transient failures) and adversarial prompt injections across 5 operational scenarios. It provides two reference policies: a `NaiveAgent` (0 retries, unverified schema, executes untrusted logs) which scores 1/9 (11.1%, 95% Wilson CI: [2.0%, 43.5%]), and a `RobustAgent` (configurable retries, schema defense, log isolation, postcondition check) which recovers from transient failures and isolates injections.
- **The Honest Boundary**: This 11.1% vs 100% gap is not an empirical discovery about LLMs in the wild; it is a sanity check validating that the harness successfully separates brittle reference policies from defensive ones.

### Point 2: Delta Debugging (`ddmin`) for Fault Localization
- **The Question / Hook**: *"When an agent fails in a cascade of multiple infrastructure errors, how do you find the root cause?"*
- **What AgentProbe Does**: Implemented delta debugging (`ddmin`) to reduce multi-fault schedules to the minimal breaking fault set in $\le 20$ reruns. For example, when a 3-fault schedule breaks an agent, `ddmin` systematically tests complementary partitions, identifying the single 1-fault trigger (e.g. an unhandled schema error) while recording every counterfactual probe run ID as verifiable proof.
- **The Honest Boundary**: `ddmin` assumes failure monotonicity (if a subset fails, the superset fails). It isolates the minimal schedule within the simulated tool space, but does not diagnose internal model weight activations.

### Point 3: Auto-Hardening with Measured Counterfactual Re-runs
- **The Question / Hook**: *"How do you fix agent failures without hallucinating improvements?"*
- **What AgentProbe Does**: When an agent fails, the auto-hardening loop inspects the deterministic grader failure class, maps it to a targeted `PolicyConfig` patch (e.g. `max_retries: 3`, `validate_schema: true`, `treat_output_as_data: true`, `verify_postconditions: true`), and executes an automated re-run on the exact same scenario and seed. It returns a measured before/after delta and never claims a fix without passing verification.
- **The Honest Boundary**: The auto-hardening synthesizes structured configuration guardrails for deterministic agents, not automatic prompt engineering or weight updates for black-box models.

### Point 4: Honest Machine Learning & Eliminating Data Leakage
- **The Question / Hook**: *"How do you predict agent failure risk before deployment without overfitting on synthetic data?"*
- **What AgentProbe Does**: Built a scikit-learn Random Forest classifier trained strictly on real stored runs (zero synthetic rows). It employs a disjoint grouped split by `(scenario_id, seed)` so identical conditions never leak between train and validation folds. When real runs $n < 200$, the API and UI display a loud warning (*"Insufficient data: metrics are not meaningful"*) and grey out accuracy and ROC AUC to prevent false confidence, benchmarking directly against the majority-class baseline.
- **The Honest Boundary**: Small-data demonstration model ($n < 200$). It is not evaluated for production deployment decisions.

### Point 5: Real LLM Evaluation, Rate Limiting & Replay Provenance
- **The Question / Hook**: *"How do you integrate live LLMs while keeping testing deterministic, cost-effective, and safe from quota exhaustion?"*
- **What AgentProbe Does**: Built an OpenAI-compatible adapter supporting Google Gemini API (`models/gemini-3.8-flash`) and local Ollama. It enforces a strict 10-step agent cap, a 300-call execution budget, and exponential backoff with jitter on 429/5xx responses. Real live exchanges were captured into version-controlled cassettes with explicit provenance metadata (`provenance: "recorded"`, `model: "models/gemini-3.8-flash"`, ISO timestamp), enabling fully offline deterministic replay without external network calls or paid API keys.
- **The Honest Boundary**: Recorded cassettes reflect point-in-time model behavior on free-tier rate limits; live execution depends on upstream provider availability.

---

## 3. The "Do NOT Claim" List

| What You Might Be Tempted to Say | Why It Is Inaccurate | What to Say Instead |
|---|---|---|
| *"I fine-tuned Llama/Gemini on agent trajectories."* | No model weights were trained or fine-tuned. The repo contains an unexecuted reference script. | *"I built a sanitized export pipeline (`/api/export/finetune.jsonl`) that strips secrets and filters adversarial injections for an optional LoRA workflow."* |
| *"I proved that AI agents are safe for production ops."* | Operations run in an in-memory mock environment with 4 simulated tools. | *"I built a deterministic sandbox to stress-test tool-calling logic and guardrails under simulated infrastructure faults."* |
| *"My ML model predicts agent failures with high accuracy."* | The dataset has $< 200$ runs, making holdout metrics statistically unvalidated. | *"I built a risk predictor prototype trained strictly on real runs that explicitly flags insufficient data when $n < 200$ and benchmarks against majority baseline."* |
| *"I discovered that AI agents have an 11.1% success rate."* | 11.1% (1/9) is the exact score of an author-written brittle reference policy (`NaiveAgent`). | *"I designed a naive baseline policy whose 1/9 pass rate demonstrates that the test harness effectively penalizes missing retries and unverified postconditions."* |
| *"I ran an automated LLM judge to evaluate agent behavior."* | AgentProbe deliberately avoids LLM judges due to non-determinism and cost. | *"I built a deterministic assertion-based grader with zero LLM judge dependency, verifying exact evidence, state transitions, and authorization invariants."* |

---

## 4. Ground Truth Test Metrics

- **Backend Pytest Suite**: 37 tests passed (covering API endpoints, core engine, claims audit, predictor honesty, secret scanner, and Wilson confidence interval statistics).
- **Frontend Vitest Suite**: 2 tests passed (navigation, header status). Production Vite bundle: built cleanly in 9.3s with zero TypeScript errors.
- **Total Test Count**: 39 automated tests.
- **Recorded Cassettes**: 5 real recorded cassettes from Google Gemini API (`models/gemini-3.8-flash`) with honest `provenance: "recorded"`.
