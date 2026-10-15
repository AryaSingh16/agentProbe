import httpx

def main():
    client = httpx.Client(timeout=15.0)

    # 1. Check Web & Docs
    r_web = client.get('http://localhost:3000')
    print('Web Frontend (http://localhost:3000):', r_web.status_code)
    assert r_web.status_code == 200

    r_docs = client.get('http://localhost:8000/docs')
    print('API Docs (http://localhost:8000/docs):', r_docs.status_code)
    assert r_docs.status_code == 200

    # 2. Baseline Run via Web Nginx Proxy (http://localhost:3000/api/runs)
    r_base = client.post('http://localhost:3000/api/runs', json={
        'scenario_id': 'bad_deploy',
        'agent_type': 'robust',
        'fault_intensity': 0,
        'seed': 42
    })
    base_data = r_base.json()
    print('Baseline Run via Proxy:', base_data['id'], base_data['grader_result']['verdict'])
    assert base_data['grader_result']['verdict'] == 'PASSED'

    # 3. Faulted Run via Web Nginx Proxy
    r_fault = client.post('http://localhost:3000/api/runs', json={
        'scenario_id': 'bad_deploy',
        'agent_type': 'naive',
        'fault_type': 'timeout',
        'fault_intensity': 2,
        'seed': 42
    })
    fault_data = r_fault.json()
    run_id = fault_data['id']
    print('Faulted Run via Proxy:', run_id, fault_data['grader_result']['verdict'], fault_data['grader_result']['failure_class'])
    assert fault_data['grader_result']['verdict'] != 'PASSED'

    # 4. Shrink via Web Nginx Proxy
    r_shrink = client.post(f'http://localhost:3000/api/shrink/{run_id}?max_reruns=15')
    shrink_data = r_shrink.json()
    print(f'Shrink Minimal Faults via Proxy: {shrink_data["minimal_fault_count"]} (Original: {shrink_data["original_fault_count"]})')
    assert shrink_data['minimal_fault_count'] <= shrink_data['original_fault_count']

    # 5. Harden via Web Nginx Proxy
    r_harden = client.post(f'http://localhost:3000/api/harden/{run_id}')
    harden_data = r_harden.json()
    print(f'Hardened Re-run Verdict via Proxy: {harden_data["re_run_verdict"]}, Fixed: {harden_data["fixed_failures"]}')
    assert harden_data['re_run_verdict'] == 'PASSED'

    print('\n>>> ALL DOCKER COMPOSE INTEGRATION TESTS PASSED! <<<')

if __name__ == '__main__':
    main()
