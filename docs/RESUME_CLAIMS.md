# AgentProbe Resume Claims & Interview Guide 🎯

This document defines the verified claims, interview talking points, and honest boundaries for discussing **AgentProbe**. Every figure in this document comes strictly from actual execution logs and test suites in this repository.

---

## 1. Resume Bullets

### 1-Line Bullet:
> Engineered an AI agent fault-injection & reliability testing harness with deterministic assertion grading, delta debugging (`ddmin`) minimal fault set isolation, automated policy hardening, and live LLM tool-calling evaluations with rate-limiting and session recording.

### 2-Line Bullet:
> Engineered full-stack AI agent reliability platform (FastAPI, React 18, SQLite) evaluating agents across 5 ops incident scenarios and 5 fault modes with sample-size ($n$) reporting and Wilson 95% score confidence intervals; implemented `ddmin` minimal breaking fault isolation, automated counterfactual policy re-runs, and live Google Gemini Flash tool-calling integration with strict rate-limiting, backed by 68 automated tests (56 Pytest, 12 Vitest).

---

## 2. Five Interview Talking Points

### Point 1: Harness Sensitivity & Reference Policies
- **The Question / Hook**: *"How do you evaluate whether an AI agent is actually robust against tool and infrastructure failures?"*
- **What AgentProbe Does**: AgentProbe tests agents against deterministic fault schedules (timeouts, HTTP 500s, malformed JSON, empty responses, transient failures) and adversarial prompt injections across 5 operational scenarios. It provides two deterministic reference policies: a `NaiveAgent` (0 retries, unverified schema, executes untrusted log instructions) which fails rapidly under faults, and a `RobustAgent` (configurable retries, schema defense, log isolation, postcondition check) which recovers from transient failures and isolates prompt injections.
- **The Honest Boundary**: The performance gap between Naive and Robust is an author-written sanity check validating that the harness successfully separates brittle reference policies from defensive ones—not an empirical discovery about LLMs in the wild.

### Point 2: Delta Debugging (`ddmin`) for Fault Localization
- **The Question / Hook**: *"When an agent fails in a cascade of multiple infrastructure errors, how do you find the root cause?"*
- **What AgentProbe Does**: Implemented delta debugging (`ddmin`) to reduce multi-fault schedules to the minimal breaking fault set in $\le 20$ reruns. When a multi-fault schedule breaks an agent, `ddmin` systematically tests complementary partitions, identifying the minimal subset (e.g. an unhandled schema error on step 2) while recording every counterfactual probe run ID as verifiable evidence.
- **The Honest Boundary**: `ddmin` assumes failure monotonicity (if a subset fails, the superset fails). It isolates the minimal schedule within the simulated tool space, but does not inspect internal model weight activations.

### Point 3: Auto-Hardening with Measured Counterfactual Re-runs
- **The Question / Hook**: *"How do you fix agent failures without hallucinating improvements?"*
- **What AgentProbe Does**: When an agent fails, the auto-hardening loop inspects the deterministic grader failure class, maps it to a targeted `PolicyConfig` patch (e.g. `max_retries: 3`, `validate_schema: true`, `treat_output_as_data: true`, `verify_postconditions: true`), and executes an automated re-run on the exact same scenario and seed. It returns a measured before/after delta and never claims a fix without passing verification.
- **The Honest Boundary**: The auto-hardening synthesizes structured configuration guardrails for deterministic agents, not automatic prompt engineering or weight updates for black-box models.

### Point 4: Honest Risk Estimation & Leave-One-Scenario-Out Validation
- **The Question / Hook**: *"How do you predict agent failure risk before deployment without overfitting on synthetic data?"*
- **What AgentProbe Does**: Implemented an honest failure risk estimator using regularized logistic regression trained strictly on real executed runs (zero synthetic rows). It employs a leave-one-scenario-out cross-validation split so test conditions never leak between training and validation folds. When real runs $n < 200$, the API and UI display a prominent warning (*"Simulation-based risk estimation: insufficient data"*), benchmarking directly against the majority-class baseline.
- **The Honest Boundary**: Outcomes in this simulator are deterministic, so high scores are expected and do not show real-world predictive power. Small-data demonstration model ($n < 200$), not evaluated for production deployment decisions.

### Point 5: Real LLM Evaluation, Rate Limiting & Replay Provenance
- **The Question / Hook**: *"How do you integrate live LLMs while keeping testing deterministic, cost-effective, and safe from quota exhaustion?"*
- **What AgentProbe Does**: Built an OpenAI-compatible adapter supporting live Google Gemini API (`models/gemini-3.5-flash`). It enforces a strict 10-step agent cap, rolling rate-limiting ($\le 4$ req/min), and exponential backoff that honors `Retry-After`. In testing ($n=12$ live API calls), 3 scenarios (`healthy_service`, `bad_deploy`, `rollback_denied`) succeeded and were saved to disk with `provenance: "recorded"`, while 429 quota exhaustion after retries was cleanly handled as `Verdict.NOT_COMPLETED` (Agent Error) without crashing and without skewing matrix metrics.
- **The Honest Boundary**: Free-tier rate limits constrain live test throughput; recorded sessions enable repeatable offline regression testing without recurring API calls or leaked keys.

---

## 3. The "Do NOT Claim" List

| What You Might Be Tempted to Say | Why It Is Inaccurate | What to Say Instead |
|---|---|---|
| *"I fine-tuned Llama/Gemini on agent trajectories."* | No model weights were trained or fine-tuned. The repo contains an unexecuted reference script. | *"I built a sanitized export pipeline (`/api/export/finetune.jsonl`) that strips secrets and filters adversarial injections for an optional LoRA workflow."* |
| *"I proved that AI agents are safe for production ops."* | Operations run in an in-memory mock environment with 4 simulated tools. | *"I built a deterministic sandbox to stress-test tool-calling logic and guardrails under simulated infrastructure faults."* |
| *"My ML model predicts agent failures with high accuracy."* | The dataset has $< 200$ runs and deterministic mechanics, making real-world predictive claims unfounded. | *"I built a risk predictor prototype trained strictly on real runs that uses leave-one-scenario-out cross-validation and benchmarks against majority baseline."* |
| *"I ran an automated LLM judge to evaluate agent behavior."* | AgentProbe deliberately avoids LLM judges due to non-determinism, hallucinations, and cost. | *"I built a deterministic assertion-based grader with zero LLM judge dependency, verifying exact evidence, state transitions, and authorization invariants."* |

---

## 4. Ground Truth Test Metrics

- **Backend Pytest Suite**: 56 tests passed (covering API endpoints, core engine, claims audit, predictor honesty, secret scanner, live LLM error handling, and Wilson confidence interval statistics).
- **Frontend Vitest Suite**: 12 tests passed (clean display text, dropdown payloads, query invalidation, and component rendering).
- **Total Test Count**: 68 automated tests.
- **Production Vite Bundle**: Built cleanly with zero TypeScript errors.
- **Cassettes**: 3 live recorded cassettes (`provenance: "recorded"`) and 2 hand-authored baseline cassettes (`provenance: "hand-authored"`), all verified free of secrets and error dumps.
