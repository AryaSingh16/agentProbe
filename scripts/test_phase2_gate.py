"""
Phase 2 Hard Gate Verification Script:
Interacts with live uvicorn server at http://127.0.0.1:8000:
1. Healthcheck /api/health
2. Baseline run (RobustAgent, 0 faults) -> PASSED
3. Faulted run (NaiveAgent, 3 faults) -> FAILED
4. Full Matrix evaluation -> verifies Naive fails visibly more than Robust
5. Shrinker on failing run -> verifies minimal set
6. Auto-hardening on failing run -> verifies measured improvement
"""
import sys
import time
import httpx

BASE_URL = "http://127.0.0.1:8000"

def main():
    print("--- 1. Testing GET /api/health ---")
    with httpx.Client(timeout=10.0) as client:
        r = client.get(f"{BASE_URL}/api/health")
        print(f"Health Response ({r.status_code}): {r.json()}")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

        print("\n--- 2. Creating Baseline Run (RobustAgent, 0 faults) ---")
        base_payload = {
            "scenario_id": "bad_deploy",
            "agent_type": "robust",
            "fault_intensity": 0,
            "seed": 42
        }
        r_base = client.post(f"{BASE_URL}/api/runs", json=base_payload)
        base_run = r_base.json()
        print(f"Baseline Run ID: {base_run['id']}, Verdict: {base_run['grader_result']['verdict']}")
        assert base_run["grader_result"]["verdict"] == "PASSED"

        print("\n--- 3. Creating Faulted Run (NaiveAgent, 3 faults) ---")
        fault_payload = {
            "scenario_id": "bad_deploy",
            "agent_type": "naive",
            "fault_type": "timeout",
            "fault_intensity": 3,
            "seed": 42
        }
        r_fault = client.post(f"{BASE_URL}/api/runs", json=fault_payload)
        fault_run = r_fault.json()
        fault_id = fault_run["id"]
        print(f"Faulted Run ID: {fault_id}, Verdict: {fault_run['grader_result']['verdict']}, Failure Class: {fault_run['grader_result']['failure_class']}")
        assert fault_run["grader_result"]["verdict"] != "PASSED"

        print("\n--- 4. Running Matrix Evaluation Job ---")
        matrix_payload = {
            "scenarios": ["healthy_service", "bad_deploy", "injected_instruction"],
            "agents": ["naive", "robust"],
            "fault_types": ["none", "timeout", "http_500"],
            "intensity": 2,
            "seed": 42
        }
        r_mat = client.post(f"{BASE_URL}/api/matrix", json=matrix_payload)
        job_id = r_mat.json()["job_id"]
        print(f"Started Matrix Job: {job_id}")

        # Poll status
        for _ in range(30):
            r_stat = client.get(f"{BASE_URL}/api/matrix/{job_id}")
            stat = r_stat.json()
            if stat["status"] in ("completed", "failed"):
                break
            time.sleep(0.5)

        print(f"Matrix Job Status: {stat['status']}")
        assert stat["status"] == "completed"
        heatmap = stat["heatmap"]
        print("Reliability Matrix Heatmap (Success Rates):")
        for ag, row in heatmap.items():
            print(f"  {ag:10s}: {row}")

        # Confirm Naive fails more than Robust
        naive_rates = [v for v in heatmap["naive"].values() if v is not None]
        robust_rates = [v for v in heatmap["robust"].values() if v is not None]
        naive_avg = sum(naive_rates) / len(naive_rates)
        robust_avg = sum(robust_rates) / len(robust_rates)
        print(f"\nNaive Average Success Rate: {naive_avg*100:.1f}%")
        print(f"Robust Average Success Rate: {robust_avg*100:.1f}%")
        assert robust_avg > naive_avg, f"Robust ({robust_avg}) must outperform Naive ({naive_avg})"

        print("\n--- 5. Testing Fault Shrinker on Failed Run ---")
        r_shrink = client.post(f"{BASE_URL}/api/shrink/{fault_id}?max_reruns=15")
        shrink_res = r_shrink.json()
        print(f"Shrink Result: Original Faults: {shrink_res['original_fault_count']} -> Minimal Faults: {shrink_res['minimal_fault_count']}")
        print(f"Iterations: {shrink_res['iterations_count']}, Counterfactual runs: {len(shrink_res['counterfactual_runs'])}")
        assert shrink_res["minimal_fault_count"] <= shrink_res["original_fault_count"]
        assert shrink_res["iterations_count"] > 0

        print("\n--- 6. Testing Auto-Hardening Loop on Failed Run ---")
        r_harden = client.post(f"{BASE_URL}/api/harden/{fault_id}")
        harden_res = r_harden.json()
        print(f"Hardening Diff: {harden_res['policy_diff']}")
        print(f"Before Verdict: {harden_res['before_metrics']['verdict']} -> After Verdict: {harden_res['re_run_verdict']}")
        print(f"Fixed Failures: {harden_res['fixed_failures']}")
        assert harden_res["re_run_verdict"] == "PASSED"
        assert len(harden_res["fixed_failures"]) > 0

        print("\n>>> ALL PHASE 2 HARD GATE CHECKS PASSED LIVE! <<<")

if __name__ == "__main__":
    main()
