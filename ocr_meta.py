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
DEFAULT_N_PREDICT = int(os.environ.get("N_PREDICT", "1024"))
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
METADATA_PROMPT = os.environ.get(
    "METADATA_PROMPT",
    """Extract metadata from the bank statement image into a single JSON object. Output *only* the JSON object, nothing else.

Required JSON keys and extraction rules:
*   `bank_name`: (string) Name/logo of the bank.
*   `account_holder_name`: (string) Full name of the primary account holder only. Exclude titles (Mr., Miss) or address details if present on the same line.
*   `account_holder_address`: (string or null) Full address. Use `null` if not found.
*   `account_number`: (string) Account identifier (often labeled "ACCOUNT NO").
*   `account_type`: (string) Account type description (e.g., "SAVINGS ACCOUNT GENERAL").
*   `currency`: (string) Currency code (e.g., "LKR").
*   `statement_date`: (string) The "as at" or statement generation date, **formatted strictly as YYYY-MM-DD**. Infer the year if necessary based on context.
*   `total_debits`: (string) Total debit amount from the summary/total row. Extract as text.
*   `total_credits`: (string) Total credit amount from the summary/total row. Extract as text.
*   `final_balance`: (string) Final account balance (often labeled "BALANCE AS AT DATE"). Extract as text.

Ensure the output is a single, valid JSON object starting with `{` and ending with `}`.""",
)


def main():
    parser = argparse.ArgumentParser(
        description="Extract metadata from a bank statement image."
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
        METADATA_PROMPT,
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
