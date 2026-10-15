# AgentProbe Fine-Tuning Pipeline (LoRA)

> **IMPORTANT NOTICE**: This fine-tuning script is optional and **NOT executed in Docker Compose** or the default demo. It requires an NVIDIA GPU (CUDA), PyTorch, Hugging Face `transformers`, `peft`, `trl`, and `bitsandbytes`. It has not been trained or evaluated in this environment. Do not claim that any model was fine-tuned as part of the default AgentProbe setup.

---

## 1. Overview

AgentProbe exports high-fidelity, sanitized operational traces formatted as chat interactions from **successful, graded RobustAgent runs only** via:
```bash
curl -O http://localhost:8000/api/export/finetune.jsonl
```

### Sanitization Guarantees:
- **Zero Secrets**: All authorization tokens (e.g. `VALID_OPS_TOKEN_2026`) and credentials are automatically stripped and replaced with `[REDACTED_OPS_TOKEN]`.
- **Zero Poisoning**: Scenarios with adversarial prompt injections (such as `injected_instruction`) are strictly filtered out to avoid training models on malicious instructions.
- **Success Only**: Only runs that met 100% of scenario assertions, evidence requirements, and postconditions are included.

---

## 2. Hardware Requirements

- **GPU**: NVIDIA GPU with >= 16 GB VRAM (e.g., RTX 3090, RTX 4090, A10G, A100).
- **CUDA**: Version 12.1 or newer.
- **RAM**: >= 32 GB system memory.

---

## 3. How to Run (Optional Standalone)

1. Install dependencies:
```bash
pip install torch transformers peft trl datasets bitsandbytes accelerate
```

2. Download your exported training corpus from AgentProbe:
```bash
curl -o finetune.jsonl http://localhost:8000/api/export/finetune.jsonl
```

3. Launch LoRA fine-tuning:
```bash
python finetune/train_lora.py --data_path finetune.jsonl --model_name meta-llama/Llama-3.2-3B-Instruct --output_dir ./lora_output
```
