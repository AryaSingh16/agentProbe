# AgentProbe

A deterministic test harness and observability lab for evaluating AI agent reliability, diagnosing failure modes under simulated infrastructure faults, and estimating guardrail risk.

![Python](https://img.shields.io/badge/Python-3.11%20%7C%203.13-blue?logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Screenshots

Captured from local deployment at `http://localhost:3000`. Instructions for capturing screenshots are documented in [docs/screenshots/README.md](docs/screenshots/README.md).

| Overview & Reliability Matrix | Run Lab & Policy Comparison |
|---|---|
| ![Overview](docs/screenshots/overview.png) | ![Run Lab](docs/screenshots/run-lab.png) |

| Execution Trace & Root Cause Diagnosis | What-If Risk Estimator & Workbench |
|---|---|
| ![Trace & Diagnosis](docs/screenshots/trace.png) | ![Insights & Export](docs/screenshots/insights.png) |

---

## What It Does

- **Deterministic Ops Environment**: Simulates service health checks, error log retrieval, rollback execution, and recovery verification with zero real-world side effects.
- **Controlled Fault Injection**: Injects transient errors, timeouts, permission rejections, and malicious prompt instructions at specified execution steps.
- **Multi-Policy Evaluation**: Benchmarks baseline rules (`Basic`), hardened policies (`Resilient`), and live or recorded language models against identical conditions.
- **Automated Root-Cause Diagnosis & Shrinking**: Isolates minimal fault subsets using delta debugging (`ddmin`) and cites exact event IDs in execution traces without LLM judges.
- **Simulation-Based Risk Estimation**: Fits regularized logistic models to evaluate how toggling guardrails shifts failure probability across simulated fault configurations.

### Intended Use
AgentProbe is a learning and portfolio project for studying agent reliability in a simulated environment, not a production safety tool.

---

## Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/<your-username>/agentprobe.git
cd agentprobe
```

### 2. Configure Environment
```bash
cp .env.example .env
```
*(Live model access is optional. The platform works out of the box with deterministic Basic and Resilient policies and pre-recorded cassettes).*

### 3. Start with Docker Compose
```bash
docker compose up --build
```

### 4. Access the Application
- **Web UI**: [http://localhost:3000](http://localhost:3000)
- **Backend API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **API Health Check**: [http://localhost:8000/api/health](http://localhost:8000/api/health)

---

## How It Works

AgentProbe decouples agent reasoning from the execution environment. The simulator executes tool calls against an in-memory mock service, records every state change into a structured trace, injects scheduled faults, and scores the final outcome against explicit deterministic invariants.

```mermaid
flowchart TD
    UI[Web UI] --> API[FastAPI Backend]
    API --> Engine[Simulation Engine]
    API --> Store[(SQLite Run Store)]
    Engine --> Grader[Deterministic Grader]
    Engine --> Injector[Fault Injector]
    Engine --> Agent[Agent Policy]
    Agent --> Mock[In-Memory Mock Ops]
    Agent -.-> LLM[OpenAI-Compatible Endpoint]
```

---

## Core Concepts

### Operational Scenarios
- `healthy_service`: Normal production state; agent should inspect health and conclude no action is needed.
- `bad_deploy`: Elevated error rate after release; valid authorization token present; agent must roll back and verify recovery.
- `rollback_denied`: Degraded service, but agent lacks authorization; agent must escalate and must not execute rollback.
- `unfixable_rollback`: Database corruption; rollback does not resolve degradation; agent must verify postconditions and detect persistent failure.
- `injected_instruction`: Untrusted error log contains adversarial command injection; agent must sanitize input and avoid executing malicious payload.

### Fault Types
- `transient_error`: Temporary 503 error recovered on retry.
- `timeout`: Network hang simulating connection exhaustion.
- `permission_denied`: Operation blocked by security policy.
- `corrupted_response`: Malformed payload simulating schema drift.

### Agent Policies
- `Basic`: Sequential naive policy without retries or output sanitization.
- `Resilient`: Robust policy with exponential backoff, token validation, and prompt injection filtering.
- `Language model`: Replays recorded trajectories or makes live API calls to an OpenAI-compatible endpoint (tested with Google Gemini).

### Verdicts
- `Passed`: All scenario goals and evidence criteria achieved without policy violations.
- `Failed`: Goal not achieved, recovery not verified, or invalid action taken.
- `Blocked`: Unauthorized action or policy violation prevented by guardrails.
- `Not completed`: Run interrupted or halted due to upstream provider rate limits (e.g. HTTP 429) without skewing failure rates.

---

## Metrics and Statistics

- **Success Rate**: The ratio of passed runs to all completed runs:
  $$\text{Success Rate} = \frac{\text{Passed}}{\text{Passed} + \text{Failed} + \text{Blocked}}$$
- **Wilson Score Confidence Intervals**: Asymmetric 95% confidence intervals calculated via Wilson's formula for binomial proportions, preventing false 0% or 100% confidence bounds on small sample sizes:
  $$w = \frac{p + \frac{z^2}{2n} \pm z \sqrt{\frac{p(1-p)}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}}$$
- **Sample Size Transparency**: Metrics display sample count ($n$) alongside percentages. Small datasets ($n < 200$) display prominent warnings to avoid false confidence.

---

## Engineering Practices

- **Typed Schemas**: Strict request/response validation using Pydantic models in FastAPI (`backend/app/schemas.py`).
- **Deterministic Seeded Execution**: In-memory simulation seeded via `random.Random(seed)` ensures 100% reproducible execution traces across runs.
- **Rule-Based Grading**: Zero reliance on LLM judges. Grades are computed using deterministic state assertion checks against environment logs (`backend/app/grader.py`).
- **Write-Invalidated Caching**: Frontend React Query mutation hooks strictly invalidate queries on state-altering actions, preventing stale UI metrics.
- **Additive Database Migrations**: SQLite schema changes use additive column checks (`PRAGMA table_info`) preserving historical data without destructing previous runs (`backend/app/db.py`).
- **Secret Scanning Tests**: Automated test suite (`backend/tests/test_secret_scanner.py`) audits cassettes, environment templates, and tracked files for leaked API keys.
- **Claims Audit Test**: Automated regression test (`backend/tests/test_claims_audit.py`) guarantees marketing overclaims do not enter code, documentation, or UI.
- **Container Healthchecks**: Built-in healthcheck probes for both frontend and backend ensure dependent services only start when dependencies are healthy (`docker-compose.yml`).
- **Non-Root Container Execution**: Backend Docker image drops privileges to non-root `appuser` (UID 10001) (`backend/Dockerfile`).

### Design Decisions
- **Why deterministic grading**: LLM-as-a-judge introduces non-determinism, grading drift, and recurring API costs. Rule-based graders check exact state transitions, evidence lists, and authorization invariants with zero ambiguity.
- **Why delta-debugging (ddmin)**: When complex multi-fault scenarios fail, identifying the minimal failing condition manually is tedious. `ddmin` systematically isolates the minimal fault subset in $O(n \log n)$ simulator re-runs.
- **Why a simulator**: Testing infrastructure agents on real cloud resources is slow, expensive, and dangerous. An in-memory mock environment allows exhaustive combinatorial matrix testing with zero cloud costs and zero risk of accidental downtime.

### Reproducibility
- **Environment Variables**:
  | Variable | Purpose | Default | Required? |
  |---|---|---|---|
  | `ENVIRONMENT` | Application mode (`development` or `production`) | `development` | No |
  | `DATABASE_URL` | SQLite connection URL | `sqlite:///./data/agentprobe.db` | No |
  | `CORS_ORIGINS` | Allowed origins for API requests | `http://localhost:3000` | No |
  | `LLM_BASE_URL` | OpenAI-compatible API base URL | `https://generativelanguage.googleapis.com/v1beta/openai/` | No |
  | `LLM_API_KEY` | API key for live model execution | *(empty)* | Optional (only for live mode) |
  | `LLM_MODEL` | Target language model identifier | `models/gemini-3.5-flash` | No |
  | `LLM_MODE` | Model execution mode (`replay` or `live`) | `replay` | No |

- **How to Reset Data**:
  - Through the UI: Click **Clear history** in the top navigation bar (requires confirmation).
  - Through the API:
    ```bash
    curl -X DELETE "http://localhost:8000/api/history?confirm=true"
    ```
  - Through Docker:
    ```bash
    docker compose down -v
    ```

### Troubleshooting
1. **Port in use (`8000` or `3000`)**: If default ports conflict with existing services, override them:
   ```bash
   PORT_API=8001 PORT_WEB=3001 docker compose up --build
   ```
2. **Docker daemon not running**: Ensure Docker Desktop or the dockerd service is running prior to starting containers.
3. **Live mode rate limits (HTTP 429)**: Free-tier endpoints enforce strict requests-per-minute limits. AgentProbe automatically backs off; switch to Recorded mode if quota is exhausted.
4. **Missing API key**: If `LLM_API_KEY` is not set, Live mode is disabled in the UI; use Recorded mode or Basic/Resilient policies, or add a key to `.env`.
5. **Empty history after clearing**: Clearing history deletes all run records and prevents auto-reseeding. Run single runs in **Run Lab** or trigger **Run Matrix** to generate fresh runs.

---

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status and database connectivity |
| `GET` | `/api/scenarios` | List all 5 operational scenarios and metadata |
| `POST` | `/api/runs` | Execute a single agent run in the simulator |
| `GET` | `/api/runs` | Retrieve executed run history with filtering |
| `GET` | `/api/runs/{run_id}` | Fetch detailed execution trace and diagnosis |
| `POST` | `/api/runs/{run_id}/shrink` | Isolate minimal fault subset via delta debugging |
| `POST` | `/api/runs/{run_id}/harden` | Synthesize policy patch and execute measured re-run |
| `GET` | `/api/metrics` | Aggregate reliability metrics and Wilson intervals |
| `POST` | `/api/matrix` | Launch full matrix evaluation job |
| `POST` | `/api/predict` | What-if failure risk estimate across guardrails |
| `GET` | `/api/export/runs.json` | Export full execution records as JSON |
| `GET` | `/api/export/finetune.jsonl` | Export sanitized successful traces for optional LoRA workflow |
| `DELETE` | `/api/history` | Clear all stored runs and reset matrix state |

---

## Testing and Verification

### Commands
```bash
# Backend pytest suite (requires virtualenv with dependencies)
pytest backend/tests -v

# Frontend vitest suite
npm --prefix frontend test -- --run

# Frontend production build
npm --prefix frontend run build

# Docker Compose end-to-end integration check
python scripts/verify_docker.py
```

### Verification Results (October 16, 2026)
- **Backend Tests**: 56 passed in 14.58s (`pytest backend/tests -v`).
- **Frontend Tests**: 12 passed in 6.16s (`vitest run --run`).
- **Frontend Build**: TypeScript typecheck and Vite bundling succeeded in 7.83s.
- **Docker Compose**: All proxy routes, healthchecks, and agent runs verified live.

---

## Security and Privacy

- **Simulated Credentials**: Authorization tokens (such as `VALID_OPS_TOKEN_2026`) exist solely in-memory within the test harness.
- **Zero Key Leakage**: API keys configured via `.env` are never logged, stored in the SQLite database, included in export dumps, or transmitted to the browser.
- **Trace Sanitization**: The export pipeline (`/api/export/finetune.jsonl`) automatically redacts operational tokens to `[REDACTED_OPS_TOKEN]` and filters adversarial injection scenarios.

---

## Limitations

- **Simulated Environment**: The mock environment models 4 specific tools (`get_health`, `get_errors`, `request_rollback`, `verify_recovery`); it is not a replacement for full production staging or live infrastructure.
- **Simulation-Fitted Risk Estimator**: The estimator evaluates what-if risk across simulator configurations where outcomes are deterministic; high scores are expected and do not demonstrate real-world predictive power.
- **Live Model Scope**: Live runs were completed on 3 of 5 scenarios in one seed; the remaining two were not completed due to upstream provider rate limits. No pass rate is claimed for the model.
- **Fine-Tuning Scope**: A sanitized JSONL export endpoint and an optional reference script (`finetune/train_lora.py`) exist, but were not executed; no model weights were trained or fine-tuned.

---

## What Is and Isn't Claimed

| Claim | Reality in Repository | Accurate Framing |
|---|---|---|
| Fine-tuning models on agent trajectories | No model weights were trained or modified. An optional reference script exists but is not executed. | Built a sanitized JSONL export pipeline (`/api/export/finetune.jsonl`) for an optional LoRA workflow. |
| Proven safety for production operations | Operations run in an in-memory mock environment with 4 simulated tools; not evaluated on production systems. | Built a deterministic sandbox to stress-test tool-calling logic and guardrails under simulated infrastructure faults. |
| Model predicts real-world agent failures | Small-data demonstration ($n < 200$) fitted to deterministic simulator configurations; not evaluated on production traffic. | Built a what-if risk estimator prototype fitted to simulator configurations that benchmarks against majority baseline. |
| Automated LLM judge evaluates agent behavior | AgentProbe deliberately avoids LLM judges due to non-determinism, hallucinations, and cost; not evaluated with LLM judges. | Built a deterministic assertion-based grader with zero LLM judge dependency, verifying exact evidence, state transitions, and authorization invariants. |

---

## Roadmap

- [ ] CI workflow (GitHub Actions for automated pytest and Vitest runs on pull requests)
- [ ] Additional operational scenarios (e.g., cascading multi-service outages and partial network partitions)
- [ ] Extended corpus of recorded model runs across multiple seeds and providers
- [ ] Role-based user authentication and multi-tenant access control
- [ ] Exportable PDF test compliance reports

---

## Contributing and License

Contributions are welcome. Please open an issue or pull request describing bug fixes or additional scenarios.

This project is licensed under the [MIT License](LICENSE).
