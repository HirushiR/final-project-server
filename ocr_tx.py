import subprocess
import sys
import os
from pathlib import Path
import argparse

# --- Configuration ---
SCRIPT_DIR = Path(__file__).parent.resolve()
DATA_DIR = os.environ.get("DATA_DIR", str(SCRIPT_DIR / "data"))
DEFAULT_MODEL_PATH = os.environ.get(
    "MODEL_PATH", str(Path(DATA_DIR) / "gemma-3-4b-it-Q5_K_M.gguf")
)
DEFAULT_MMPROJ_PATH = os.environ.get(
    "MMPROJ_PATH", str(Path(DATA_DIR) / "mmproj-BF16.gguf")
)
DEFAULT_IMAGE_PATH = os.environ.get("IMAGE_PATH", str(Path(DATA_DIR) / "temp.png"))

# --- Default CLI Arguments ---
DEFAULT_NGL = int(os.environ.get("N_GPU_LAYERS", "34"))
DEFAULT_THREADS = int(os.environ.get("THREADS", "3"))
DEFAULT_CTX = int(os.environ.get("CONTEXT_SIZE", "16384"))
DEFAULT_N_PREDICT = int(os.environ.get("N_PREDICT", "2048"))
DEFAULT_TEMP = float(os.environ.get("TEMPERATURE", "0.3"))
DEFAULT_CACHE_TYPE_K = os.environ.get("CACHE_TYPE_K", "q4_1")
DEFAULT_CACHE_TYPE_V = os.environ.get("CACHE_TYPE_V", "q4_1")
DEFAULT_FLASH_ATTN = os.environ.get("FLASH_ATTN", "1").lower() in (
    "1",
    "true",
    "yes",
    "on",
)
DEFAULT_MLOCK = os.environ.get("MLOCK", "1").lower() in ("1", "true", "yes", "on")
LLAMA_CLI_EXECUTABLE = os.environ.get("LLAMA_CLI_EXECUTABLE", "llama-gemma3-cli")

# --- Prompt Definition ---
TRANSACTIONS_PROMPT = os.environ.get(
    "TRANSACTIONS_PROMPT",
    """Extract transaction rows from the bank statement image. Output *only* a single JSON array of arrays, nothing else.

Identify the main transaction table data rows (between the header row and the 'TOTAL' row).

For each data row, create an inner array containing exactly 6 string elements. These elements **must** correspond to the table columns in this order:
*   [0]: Date (Extract text exactly as seen, e.g., "01.02.25" or "28/03").
*   [1]: Reference Number (Use "" if blank/not applicable).
*   [2]: Particulars/Description.
*   [3]: Debits Amount (Use "" if blank. Extract as text).
*   [4]: Credits Amount (Use "" if blank. Extract as text).
*   [5]: Running Balance (Extract as text).

CRITICAL: The output must be only the JSON array, starting with `[` and ending with `]`. Each inner array must have exactly 6 string elements in the specified order. Do not include header or total rows.""",
)


def main():
    parser = argparse.ArgumentParser(
        description="Extract transactions from a bank statement image."
    )
    # Add arguments corresponding to the Bash script overrides
    parser.add_argument("--ngl", type=int, default=DEFAULT_NGL)
    parser.add_argument("--threads", type=int, default=DEFAULT_THREADS)
    parser.add_argument(
        "-c", "--ctx", type=int, default=DEFAULT_CTX, dest="context_size"
    )
    parser.add_argument(
        "-n", "--n-predict", type=int, default=DEFAULT_N_PREDICT, dest="n_predict"
    )
    parser.add_argument("--temp", type=float, default=DEFAULT_TEMP)
    parser.add_argument(
        "-ctk",
        "--cache-type-k",
        type=str,
        default=DEFAULT_CACHE_TYPE_K,
        dest="cache_type_k",
    )
    parser.add_argument(
        "-ctv",
        "--cache-type-v",
        type=str,
        default=DEFAULT_CACHE_TYPE_V,
        dest="cache_type_v",
    )
    # Add arguments for paths if needed, otherwise use defaults
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--mmproj", type=Path, default=DEFAULT_MMPROJ_PATH)
    parser.add_argument("--image", type=Path, default=DEFAULT_IMAGE_PATH)

    args = parser.parse_args()

    # --- Validate Paths ---
    if not Path(args.model).is_file():
        print(f"Error: Model file not found at {args.model}", file=sys.stderr)
        sys.exit(1)
    if not Path(args.mmproj).is_file():
        print(f"Error: MMPROJ file not found at {args.mmproj}", file=sys.stderr)
        sys.exit(1)
    if not Path(args.image).is_file():
        print(f"Error: Image file not found at {args.image}", file=sys.stderr)
        sys.exit(1)

    # --- Construct Command ---
    command = [
        LLAMA_CLI_EXECUTABLE,
        "-m",
        str(args.model),
        "--mmproj",
        str(args.mmproj),
        "--image",
        str(args.image),
        "-p",
        TRANSACTIONS_PROMPT,
        "-ngl",
        str(args.ngl),
        "--threads",
        str(args.threads),
        "-c",
        str(args.context_size),
        "-n",
        str(args.n_predict),
        "--temp",
        str(args.temp),
        "-ctk",
        args.cache_type_k,
        "-ctv",
        args.cache_type_v,
    ]
    if DEFAULT_FLASH_ATTN:
        command.append("-fa")
    if DEFAULT_MLOCK:
        command.append("--mlock")

    # print(f"Executing: {' '.join(command)}", file=sys.stderr) # Optional debug

    # --- Execute and Capture Output ---
    try:
        process = subprocess.run(
            command,
            check=True,  # Raise error on non-zero exit
            capture_output=True,  # Capture stdout/stderr
            text=True,  # Decode output as text
        )
        # Print only the stdout to mimic the Bash script
        print(process.stdout.strip())
        # if process.stderr: # Optional: print stderr for debugging
        #     print("\n--- stderr ---", file=sys.stderr)
        #     print(process.stderr.strip(), file=sys.stderr)

    except FileNotFoundError:
        print(f"Error: '{LLAMA_CLI_EXECUTABLE}' command not found.", file=sys.stderr)
        print(
            "Please ensure llama.cpp is built and its binaries are in your PATH.",
            file=sys.stderr,
        )
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"Error: Command failed with exit code {e.returncode}", file=sys.stderr)
        print("\n--- stderr ---", file=sys.stderr)
        print(e.stderr.strip(), file=sys.stderr)
        print("\n--- stdout ---", file=sys.stderr)
        print(e.stdout.strip(), file=sys.stderr)
        sys.exit(e.returncode)
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
