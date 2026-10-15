# AgentProbe Verification & Honesty Checklist

This document details the step-by-step verification procedure and exact expected results for AgentProbe telemetry, test execution, deterministic ordering, and batch isolation.

---

## Verification Steps & Expected Outcomes

### Step 1: Clear History
- **Action**: In **Insights & Export**, type `CLEAR` and execute "Clear test history", or send `DELETE /api/history?confirm=true`.
- **Expected Outcome**:
  - Telemetry database is emptied of all prior runs.
  - Overview / History shows clean empty state: **"No runs yet"**.
  - Total runs counter displays `0`.
  - Reliability matrix indicates no recorded runs.

### Step 2: Run 1 (Resilient Agent, Bad Deployment, Timeout)
- **Action**: In **Run Lab**, select:
  - Scenario: `Bad deployment` (`bad_deploy`)
  - Agent: `Resilient` (`robust`)
  - Fault: `Timeout` (`timeout`), Intensity `2`, Seed `42`
  - Click **Run under fault injection**.
- **Expected Outcome**:
  - Agent retries, rolls back bad deploy, verifies recovery, and receives verdict: **PASSED**.
  - UI automatically navigates to **Trace & Diagnosis** displaying the new run ID.
  - Navigating to **Overview** / **History**:
    - Mode defaults to **Single tests**.
    - Exactly **1 run** appears in the table.
    - Run 1 is positioned at the top with verdict `PASSED`.

### Step 3: Run 2 (Basic Agent, Bad Deployment, Timeout)
- **Action**: In **Run Lab**, select:
  - Scenario: `Bad deployment` (`bad_deploy`)
  - Agent: `Basic` (`naive`)
  - Fault: `Timeout` (`timeout`), Intensity `2`, Seed `42`
  - Click **Run under fault injection**.
- **Expected Outcome**:
  - Basic agent halts on the initial timeout failure without retrying, receiving verdict: **FAILED**.
  - Navigating to **Overview** / **History**:
    - Exactly **2 runs** appear in the table.
    - **Run 2 (Basic, FAILED) is on top**.
    - **Run 1 (Resilient, PASSED) is second**.
    - Deterministic ordering strictly prioritizes newest runs (`created_at DESC`, `rowid DESC`).

### Step 4: Run Full Matrix (First Execution)
- **Action**: In **Run Lab**, click **Run Full Matrix** (e.g. 10 seeds per cell).
- **Expected Outcome**:
  - Progress bar smoothly increments counting only actual runs executed (`Completed X of Y runs (Z%)`).
  - Total runs never exceeds executed runs.
  - Language model runs execute only from recorded real-model cassettes (once per recording), never synthesized across faults or seeds.
  - When the matrix job completes:
    - In **Overview** / **Recent Runs** under default **Single tests** view:
      - Table **STILL shows Run 2 on top, then Run 1 second**.
      - Zero matrix runs pollute the single tests view.
    - Toggle to **Matrix batches** view:
      - Shows **ONE batch row** summarizing the batch (e.g., `Full matrix: 90 runs, 78% passed`).
      - Row is expandable to inspect individual nested matrix runs.
    - Toggle to **All** view:
      - Displays all matrix runs and single test runs with a clear type badge (`Single test` vs `Matrix batch`).

### Step 5: Re-run Full Matrix (Second Execution)
- **Action**: In **Run Lab**, trigger **Run Full Matrix** a second time.
- **Expected Outcome**:
  - In **Single tests** view:
    - **Unchanged**: Still shows exactly Run 2 on top, then Run 1 second.
  - In **Matrix batches** view:
    - Shows **exactly TWO batch rows** (newest batch on top, initial batch second).
    - Each batch row clearly indicates status, run count, and pass rate.

---

## 60-Second Stability Metric
- **Zero background polling crashes**.
- **Zero runaway network loops** after completing background jobs.
- **Zero synthetic/unrecorded runs** added to history.
