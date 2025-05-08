#!/bin/bash

# --- Defaults (Matching User's Last Command Example) ---
SCRIPT_DIR=$(dirname "$0")
# Assume 'data' directory is sibling to the script directory
DATA_DIR=$(realpath "$SCRIPT_DIR/data")
MODEL_PATH="$DATA_DIR/gemma-3-4b-it-Q5_K_M.gguf"
MMPROJ_PATH="$DATA_DIR/mmproj-BF16.gguf"
IMAGE_PATH="$DATA_DIR/temp.png" # Assumes image is always named temp.png in data dir

NGL_DEFAULT=34
THREADS_DEFAULT=3
CTX_DEFAULT=16384
N_PREDICT_DEFAULT=2048 # Matching last user command example
TEMP_DEFAULT=0.3
CTK_DEFAULT="q4_1"
CTV_DEFAULT="q4_1"

# --- Assign defaults to variables ---
NGL="$NGL_DEFAULT"
THREADS="$THREADS_DEFAULT"
CTX="$CTX_DEFAULT"
N_PREDICT="$N_PREDICT_DEFAULT"
TEMP="$TEMP_DEFAULT"
CTK="$CTK_DEFAULT"
CTV="$CTV_DEFAULT"

# --- Parse Command-Line Arguments ---
# Loop through arguments two at a time
while [[ $# -gt 1 ]]; do
  key="$1"
  value="$2" # Store value for clarity

  case $key in
    --ngl) NGL="$value"; shift 2 ;;
    --threads) THREADS="$value"; shift 2 ;;
    -c|--ctx) CTX="$value"; shift 2 ;;
    -n|--n-predict) N_PREDICT="$value"; shift 2 ;;
    --temp) TEMP="$value"; shift 2 ;;
    -ctk|--cache-type-k) CTK="$value"; shift 2 ;;
    -ctv|--cache-type-v) CTV="$value"; shift 2 ;;
    *)    # unknown option
      echo "Warning: Unknown argument pair $1 $2 passed to ocr_tx.sh"
      shift # past argument or value, attempt to continue
      ;;
  esac
done

# Handle leftover argument if odd number passed
if [[ $# -gt 0 ]]; then
  echo "Warning: Ignoring leftover argument $1 in ocr_tx.sh"
fi

# --- Prompt Definition ---
TransactionsPrompt=$(cat << EOF
Analyze the provided bank statement image. Your task is to extract *only* the transaction data from the main table body. Output the result as a single JSON array containing inner arrays. Output *only* this JSON array.

1.  **Identify the Table:** Locate the table with columns like DATE, REF NO, PARTICULARS, DEBITS, CREDITS, BALANCE.
2.  **Identify Boundaries:**
    *   The data starts on the row immediately *after* the header row (the one containing "DATE", "REF NO", etc.). Include the initial "B/F" row if present.
    *   The data ends on the row immediately *before* the summary row containing the word "TOTAL".
3.  **Extract Rows:** For each row within these boundaries, create an inner array.
4.  **Column Order:** The elements in each inner array *must* be in this exact order:
    *   0: Date (string, e.g., "01.02.25")
    *   1: Reference Number (string, use "" if blank)
    *   2: Particulars/Description (string)
    *   3: Debits amount (string, use "" if blank or zero is not explicitly shown)
    *   4: Credits amount (string, use "" if blank or zero is not explicitly shown)
    *   5: Running Balance (string)
5.  **Extraction Rule:** Extract the text for each cell exactly as it appears in the image.

Do not include the table header row or the "TOTAL" row in the output array. Do not include any metadata fields (like bank name, account number, etc.).
EOF
)

# --- Execute the Command (using parsed variables, no stderr redirection) ---
# Ensure paths are correct for your setup
llama-gemma3-cli \
    -m "$MODEL_PATH" \
    --mmproj "$MMPROJ_PATH" \
    --image "$IMAGE_PATH" \
    -p "$TransactionsPrompt" \
    -ngl "$NGL" \
    -fa \
    --mlock \
    --threads "$THREADS" \
    -ctk "$CTK" \
    -ctv "$CTV" \
    -c "$CTX" \
    -n "$N_PREDICT" \
    --temp "$TEMP"