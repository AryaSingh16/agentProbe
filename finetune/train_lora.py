"""
AgentProbe Optional LoRA Fine-Tuning Script.
NOTICE: This script requires an NVIDIA GPU and is NOT executed during standard docker compose runs.
It demonstrates fine-tuning an open-source instruction model on sanitized AgentProbe traces.
"""
import argparse
import os
import sys

def main():
    parser = argparse.ArgumentParser(description="LoRA Fine-Tuning on AgentProbe Traces")
    parser.add_argument("--data_path", type=str, default="finetune.jsonl", help="Path to sanitized jsonl file")
    parser.add_argument("--model_name", type=str, default="meta-llama/Llama-3.2-3B-Instruct", help="Base model identifier")
    parser.add_argument("--output_dir", type=str, default="./lora_output", help="Directory to save adapters")
    parser.add_argument("--epochs", type=int, default=3, help="Number of training epochs")
    parser.add_argument("--batch_size", type=int, default=2, help="Per-device batch size")
    parser.add_argument("--learning_rate", type=float, default=2e-4, help="Learning rate")
    args = parser.parse_args()

    print("==================================================================")
    print(" AgentProbe Fine-Tuning Pipeline (LoRA)")
    print("==================================================================")
    print(f"Data Path:   {args.data_path}")
    print(f"Base Model:  {args.model_name}")
    print(f"Output Dir:  {args.output_dir}")
    print("Note: This script requires PyTorch, transformers, peft, trl, and CUDA GPU.")
    print("==================================================================")

    if not os.path.exists(args.data_path):
        print(f"Error: Dataset file '{args.data_path}' not found.")
        print("Please export it from AgentProbe via: GET /api/export/finetune.jsonl")
        sys.exit(1)

    try:
        import torch
        from datasets import load_dataset
        from peft import LoraConfig, get_peft_model, TaskType
        from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
        from trl import SFTTrainer
    except ImportError as e:
        print(f"\nMissing deep learning dependencies ({e}).")
        print("Install GPU dependencies with:")
        print("pip install torch transformers peft trl datasets bitsandbytes accelerate")
        sys.exit(1)

    if not torch.cuda.is_available():
        print("\nWARNING: No CUDA-capable GPU detected. Training will be prohibitively slow or fail on CPU.")
        print("Aborting training to avoid crashing system memory.")
        sys.exit(1)

    print("\nLoading dataset...")
    dataset = load_dataset("json", data_files=args.data_path, split="train")
    print(f"Loaded {len(dataset)} verified expert trajectories.")

    print(f"\nInitializing tokenizer and base model from '{args.model_name}'...")
    tokenizer = AutoTokenizer.from_pretrained(args.model_name, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.model_name,
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )

    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=4,
        learning_rate=args.learning_rate,
        logging_steps=10,
        save_strategy="epoch",
        bf16=True,
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        args=training_args,
        peft_config=lora_config,
    )

    print("\nStarting LoRA fine-tuning...")
    trainer.train()
    print(f"\nTraining completed successfully! Saving LoRA adapter weights to '{args.output_dir}'...")
    trainer.save_model(args.output_dir)
    print("Done.")

if __name__ == "__main__":
    main()
