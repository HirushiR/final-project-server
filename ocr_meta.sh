#!/bin/bash

# --- Defaults (Matching User's Last Command Example where applicable) ---
SCRIPT_DIR=$(dirname "$0")
# Assume 'data' directory is sibling to the script directory
DATA_DIR=$(realpath "$SCRIPT_DIR/data")
MODEL_PATH="$DATA_DIR/gemma-3-4b-it-Q5_K_M.gguf"
MMPROJ_PATH="$DATA_DIR/mmproj-BF16.gguf"
IMAGE_PATH="$DATA_DIR/temp.png" # Assumes image is always named temp.png in data dir

NGL_DEFAULT=34
THREADS_DEFAULT=3
CTX_DEFAULT=16384      # Matching last user command example
N_PREDICT_DEFAULT=1024 # Reduced prediction length suitable for metadata
TEMP_DEFAULT=0.3
CTK_DEFAULT="q4_1"     # Matching last user command example
CTV_DEFAULT="q4_1"     # Matching last user command example

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
      echo "Warning: Unknown argument pair $1 $2 passed to ocr_meta.sh"
      shift # past argument or value, attempt to continue
      ;;
  esac
done

# Handle leftover argument if odd number passed
if [[ $# -gt 0 ]]; then
  echo "Warning: Ignoring leftover argument $1 in ocr_meta.sh"
fi


# --- Prompt Definition ---
MetadataPrompt=$(cat << EOF
Analyze the provided bank statement image. Your task is to extract *only* the specified metadata fields. Output the result as a single JSON object containing only these keys, extracting the corresponding values exactly as seen in the image. Output *only* the JSON object.

Required JSON keys:
*   bank_name: The name or logo of the bank (e.g., "HNB").
*   account_holder_name: The full name of the primary account holder.
*   account_holder_address: The full address of the account holder.
*   account_number: The numeric account identifier, usually labeled "ACCOUNT NO".
*   account_type: The description of the account type (e.g., "SAVINGS ACCOUNT GENERAL").
*   currency: The currency code, usually labeled "CURRENCY" (e.g., "LKR").
*   statement_date: The date the statement is generated "as at", usually found near the bottom balance. Look for a date like DD-MM-YYYY.
*   total_debits: The total debit amount, usually found in a "TOTAL" row near the bottom of the transaction table.
*   total_credits: The total credit amount, usually found in a "TOTAL" row near the bottom of the transaction table.
*   final_balance: The final account balance, usually labeled "BALANCE AS AT DATE" near the very bottom.

Do not include any transaction details or table data in this output.
EOF
)

# --- Execute the Command (using parsed variables, no stderr redirection) ---
# Ensure paths are correct for your setup
llama-gemma3-cli \
    -m "$MODEL_PATH" \
    --mmproj "$MMPROJ_PATH" \
    --image "$IMAGE_PATH" \
    -p "$MetadataPrompt" \
    -ngl "$NGL" \
    -fa \
    --mlock \
    --threads "$THREADS" \
    -ctk "$CTK" \
    -ctv "$CTV" \
    -c "$CTX" \
    -n "$N_PREDICT" \
    --temp "$TEMP"