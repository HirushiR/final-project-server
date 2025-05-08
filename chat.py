import subprocess
import sys
import os
from pathlib import Path

# --- Configuration ---
# Assume 'data' directory is sibling to the script directory
SCRIPT_DIR = Path(__file__).parent.resolve()
DATA_DIR = os.environ.get("DATA_DIR", str(SCRIPT_DIR / "data"))
DEFAULT_MODEL_PATH = os.environ.get(
    "MODEL_PATH", str(Path(DATA_DIR) / "gemma-3-4b-it-Q5_K_M.gguf")
)
DEFAULT_PORT = int(os.environ.get("SERVER_PORT", "4000"))
DEFAULT_NGL = int(os.environ.get("N_GPU_LAYERS", "48"))
DEFAULT_CTX = int(os.environ.get("CONTEXT_SIZE", "8192"))
DEFAULT_BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "512"))
DEFAULT_UBATCH_SIZE = int(os.environ.get("UBATCH_SIZE", "128"))
DEFAULT_CACHE_TYPE_K = os.environ.get("CACHE_TYPE_K", "q5_1")
DEFAULT_CACHE_TYPE_V = os.environ.get("CACHE_TYPE_V", "q5_1")
DEFAULT_FLASH_ATTN = os.environ.get("FLASH_ATTN", "1").lower() in (
    "1",
    "true",
    "yes",
    "on",
)
DEFAULT_MLOCK = os.environ.get("MLOCK", "1").lower() in ("1", "true", "yes", "on")
LLAMA_SERVER_EXECUTABLE = os.environ.get("LLAMA_SERVER_EXECUTABLE", "llama-server")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Run llama-server for chat.")
    parser.add_argument(
        "-m",
        "--model",
        type=Path,
        default=DEFAULT_MODEL_PATH,
        help=f"Path to the GGUF model file (default: {DEFAULT_MODEL_PATH})",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port to listen on (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "-ngl",
        "--n-gpu-layers",
        type=int,
        default=DEFAULT_NGL,
        help=f"Number of layers to offload to GPU (default: {DEFAULT_NGL})",
    )
    parser.add_argument(
        "-c",
        "--context-size",
        type=int,
        default=DEFAULT_CTX,
        help=f"Context size (default: {DEFAULT_CTX})",
    )
    parser.add_argument(
        "-b",
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Batch size for prompt processing (default: {DEFAULT_BATCH_SIZE})",
    )
    parser.add_argument(
        "-ub",
        "--ubatch-size",
        type=int,
        default=DEFAULT_UBATCH_SIZE,
        help=f"Physical maximum batch size (default: {DEFAULT_UBATCH_SIZE})",
    )
    parser.add_argument(
        "-ctk",
        "--cache-type-k",
        type=str,
        default=DEFAULT_CACHE_TYPE_K,
        help=f"Cache type for K tensor (default: {DEFAULT_CACHE_TYPE_K})",
    )
    parser.add_argument(
        "-ctv",
        "--cache-type-v",
        type=str,
        default=DEFAULT_CACHE_TYPE_V,
        help=f"Cache type for V tensor (default: {DEFAULT_CACHE_TYPE_V})",
    )
    parser.add_argument(
        "-fa",
        "--flash-attn",
        action="store_true",  # Store true if present, false otherwise
        default=DEFAULT_FLASH_ATTN,
        help=f"Enable flash attention (default: {DEFAULT_FLASH_ATTN})",
    )
    parser.add_argument(
        "--no-flash-attn",
        action="store_false",  # Set flash_attn to false if present
        dest="flash_attn",
        help="Disable flash attention",
    )
    parser.add_argument(
        "--mlock",
        action="store_true",  # Store true if present, false otherwise
        default=DEFAULT_MLOCK,
        help=f"Use mlock to prevent paging (default: {DEFAULT_MLOCK})",
    )
    parser.add_argument(
        "--no-mlock",
        action="store_false",  # Set mlock to false if present
        dest="mlock",
        help="Disable mlock",
    )

    args = parser.parse_args()

    if not Path(args.model).is_file():
        print(f"Error: Model file not found at {args.model}", file=sys.stderr)
        sys.exit(1)

    command = [
        LLAMA_SERVER_EXECUTABLE,
        "-m",
        str(args.model),
        "--port",
        str(args.port),
        "-ngl",
        str(args.n_gpu_layers),
        "-c",
        str(args.context_size),
        "-b",
        str(args.batch_size),
        "-ub",
        str(args.ubatch_size),
        "-ctk",
        args.cache_type_k,
        "-ctv",
        args.cache_type_v,
    ]

    if args.flash_attn:
        command.append("-fa")
    if args.mlock:
        command.append("--mlock")

    print(f"Starting server: {' '.join(command)}")

    try:
        # Run the server process directly, inheriting stdio
        # This process will run until interrupted (Ctrl+C)
        process = subprocess.run(command, check=False)  # check=False as it's a server
        print(f"\nServer exited with code: {process.returncode}")
        sys.exit(process.returncode)
    except FileNotFoundError:
        print(f"Error: '{LLAMA_SERVER_EXECUTABLE}' command not found.", file=sys.stderr)
        print(
            "Please ensure llama.cpp is built and its binaries are in your PATH.",
            file=sys.stderr,
        )
        sys.exit(1)
    except Exception as e:
        print(f"An error occurred: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
