# --- Start of Prompt Definition ---
Prompt=$(cat << EOF
Extract information from the provided bank statement image into a structured JSON object. Output *only* the JSON object.

The JSON object must have two top-level keys: "metadata" and "transactions".

1.  **metadata**: An object containing key statement details. Include the following keys, extracting the corresponding values from the image (these are all placeholders to be swapped out with the actual values):
    *   `bank_name`: (e.g., "HNB")
    *   `account_holder_name`: (e.g., "MR. SMITH A B C D E")
    *   `account_holder_address`: (e.g., "B20/F1/2 KEELLS HOUSING RANGE\nUDUWANNA, HOMAGAMA")
    *   `account_number`: (e.g., "077020721982")
    *   `account_type`: (e.g., "SAVINGS ACCOUNT GENERAL")
    *   `currency`: (e.g., "LKR")
    *   `statement_date`: The "as at" date (e.g., "28-02-2025")
    *   `total_debits`: Found near the table bottom (e.g., "102,472.98")
    *   `total_credits`: Found near the table bottom (e.g., "104,470.28")
    *   `final_balance`: The "BALANCE AS AT DATE" (e.g., "2,501.02")
    *   `transaction_columns`: An array listing the column names in the exact order they appear in the inner transaction arrays below. Set this to exactly: ["date", "ref_no", "particulars", "debits", "credits", "balance"]

2.  **transactions**: An array of arrays. Each inner array represents one row from the transaction table body (starting from the first transaction or B/F row, up to the last transaction before the totals line). The elements within each inner array *must* correspond exactly in order and content to the columns defined in \`metadata.transaction_columns\`:
    *   **Required Format:** \`[date_string, ref_no_string, particulars_string, debit_string, credit_string, balance_string]\`
    *   Extract text exactly as seen from the corresponding table columns (DATE, REF NO, PARTICULARS, DEBITS, CREDITS, BALANCE).
    *   Use an empty string \`""\` for any cell that appears blank or empty in the \`ref_no\`, \`debits\`, or \`credits\` columns for a given transaction row.

Carefully parse the main body of the transaction table. Do **not** include the table header row (e.g., "DATE", "REF NO", ...) or the final "TOTAL" summary row within the \`transactions\` array itself (their aggregated values are in metadata).
EOF
)
# --- End of Prompt Definition ---

# --- Run the Command ---
llama-gemma3-cli -m data/gemma-3-4b-it-Q5_K_M.gguf --mmproj data/mmproj-BF16.gguf --image data/temp.png -p "$Prompt" -ngl 34 -fa --mlock --threads 3 -ctk q4_1 -ctv q4_1 -c 16384 -n 2048 --temp 0.3
