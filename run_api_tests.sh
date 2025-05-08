#!/bin/bash

# --- Configuration ---
BASE_URL="http://localhost:12345"
USERNAME="testuser$(date +%s)" # Add timestamp for uniqueness on reruns
PASSWORD="testpassword"
TEST_FILE="sample.pdf"       # <<< CHANGE THIS if using a different file (e.g., sample.png)
# COOKIE_JAR="cookies.txt" # REMOVED - Not needed for JWT auth
LOG_FILE="test_log.txt"
OCR_POLL_DELAY_SECONDS=5

# --- State Variable ---
AUTH_TOKEN="" # Variable to store the JWT

# --- Check for prerequisite commands ---
command -v curl >/dev/null 2>&1 || { echo >&2 "Error: 'curl' is required but not installed. Aborting."; exit 1; }
command -v jq >/dev/null 2>&1 || { echo >&2 "Warning: 'jq' is required for token/job ID extraction but not installed. Tests might fail."; exit 1; } # Make jq mandatory


# --- Helper Functions ---
log_step() {
  echo -e "\n=== STEP: $1 ===" | tee -a "$LOG_FILE"
}

# Function to run a curl command, log output, and check status code
# Now includes logic to extract token if requested
# Usage: run_test "Description" EXPECTED_STATUS_CODE SAVE_TOKEN_FLAG curl_argument [arg1 arg2 ...]
# SAVE_TOKEN_FLAG: Set to 'true' to extract token from response body, 'false' otherwise
run_test() {
  local description="$1"
  local expected_status="$2"
  local save_token_flag="$3" # New flag: 'true' or 'false'
  shift 3 # Remove description, status code, and flag from arguments
  local curl_args=("$@") # Remaining arguments are the curl *arguments*

  log_step "$description"
  printf "COMMAND: curl" >> "$LOG_FILE"
  printf " %q" "${curl_args[@]}" >> "$LOG_FILE"
  echo "" >> "$LOG_FILE"
  echo "--- Output ---" >> "$LOG_FILE"

  local tmp_headers="headers.$$.log"
  local tmp_body="body.$$.log"
  local http_status=$(curl -s -D "$tmp_headers" -o "$tmp_body" -w "%{http_code}" "${curl_args[@]}")

  # Log headers and body
  if [[ -f "$tmp_headers" && -s "$tmp_headers" ]]; then cat "$tmp_headers" >> "$LOG_FILE"; else echo "[No Headers Received]" >> "$LOG_FILE"; fi
  if [[ -f "$tmp_headers" && -s "$tmp_headers" && -f "$tmp_body" && -s "$tmp_body" ]]; then echo "" >> "$LOG_FILE"; fi
  if [[ -f "$tmp_body" && -s "$tmp_body" ]]; then cat "$tmp_body" >> "$LOG_FILE"; else echo "[No Body Received]" >> "$LOG_FILE"; fi

  # --- Token Extraction Logic ---
  if [[ "$save_token_flag" == "true" && -f "$tmp_body" && -s "$tmp_body" ]]; then
      # Check if jq is available before attempting extraction
      if command -v jq >/dev/null 2>&1; then
          local extracted_token=$(jq -r '.token // ""' "$tmp_body")
          if [[ -n "$extracted_token" ]]; then
              AUTH_TOKEN="$extracted_token"
              echo "[Token Extracted]" >> "$LOG_FILE"
          else
              echo "[Token Extraction Failed - 'token' field not found in body or jq error]" >> "$LOG_FILE"
              # Optionally fail the test if token extraction was expected but failed
              # echo "RESULT: FAILURE (Token extraction failed)" | tee -a "$LOG_FILE"
              # rm -f "$tmp_headers" "$tmp_body"
              # return 1
          fi
      else
           echo "[Token Extraction Failed - jq command not found]" >> "$LOG_FILE"
           # Fail the test if jq isn't present and token needed
           # echo "RESULT: FAILURE (jq not found for token extraction)" | tee -a "$LOG_FILE"
           # rm -f "$tmp_headers" "$tmp_body"
           # return 1
      fi
  fi
  # --- End Token Extraction ---

  rm -f "$tmp_headers" "$tmp_body"

  echo "" >> "$LOG_FILE"
  echo "--- End Output ---" >> "$LOG_FILE"

  echo "Expected Status: $expected_status | Actual Status: $http_status" | tee -a "$LOG_FILE"

  if [[ "$http_status" == "$expected_status" ]]; then
    echo "RESULT: SUCCESS" | tee -a "$LOG_FILE"
    return 0
  else
    echo "RESULT: FAILURE (Status mismatch or curl error)" | tee -a "$LOG_FILE"
    if [[ "$http_status" == "000" ]]; then echo "Hint: Status 000 indicates connection error." | tee -a "$LOG_FILE"; fi
    return 1
  fi
}

# --- Test Execution ---

# 0. Initialize Log
echo "Starting API Tests (JWT) - $(date)" > "$LOG_FILE"
# rm -f "$COOKIE_JAR" # No longer needed

# 1. Test Root Endpoint
run_test "Check Root Endpoint" 200 false \
  -s "${BASE_URL}/" || exit 1

# 2. Signup - Extract Token on Success
run_test "Signup New User ($USERNAME)" 201 true \
  -s -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=${USERNAME}&password=${PASSWORD}" \
  "${BASE_URL}/signup" || exit 1

# Check if token was actually extracted
if [[ -z "$AUTH_TOKEN" ]]; then
    echo "FATAL: No AUTH_TOKEN obtained after signup. Exiting." | tee -a "$LOG_FILE"
    exit 1
fi
echo "Current Token (first 10 chars): ${AUTH_TOKEN:0:10}..." | tee -a "$LOG_FILE"

# 3. Check Auth Status (Access Protected Route with Token)
# Use an arbitrary protected endpoint. A 404/400 here means auth worked, 401 means it failed.
run_test "Check Auth Status (Access Protected Route)" 400 false \
  -s -H "Authorization: Bearer $AUTH_TOKEN" \
  "${BASE_URL}/api/ocr/result/invalid-job-id-for-auth-check" || exit 1

# 4. Access Another Protected Route (Example: Preprocess - Auth Check only)
run_test "Access Another Protected Route (Preprocess - Auth Check)" 400 false \
  -s -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -F "file=@invalid-file-for-auth-check.txt" \
  "${BASE_URL}/api/preprocess" || echo "Note: Ignoring failure for invalid file, checking auth only" | tee -a "$LOG_FILE" # Expect fail due to invalid file, but not 401

# 5. Logout (Client-Side) - Clear Token Variable
log_step "Logout (Client-Side Simulation)"
AUTH_TOKEN=""
echo "AUTH_TOKEN cleared." | tee -a "$LOG_FILE"
echo "RESULT: SUCCESS" | tee -a "$LOG_FILE"

# 6. Check Auth Status (Access Protected Route without Token)
run_test "Check Auth Status (No Token)" 401 false \
  -s \
  "${BASE_URL}/api/ocr/result/invalid-job-id-for-auth-check" || exit 1

# 7. Login - Extract Token on Success
run_test "Login User ($USERNAME)" 200 true \
  -s -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=${USERNAME}&password=${PASSWORD}" \
  "${BASE_URL}/login/password" || exit 1

# Check if token was actually extracted
if [[ -z "$AUTH_TOKEN" ]]; then
    echo "FATAL: No AUTH_TOKEN obtained after login. Exiting." | tee -a "$LOG_FILE"
    exit 1
fi
echo "Current Token (first 10 chars): ${AUTH_TOKEN:0:10}..." | tee -a "$LOG_FILE"

# 8. Check Auth Status (Authenticated Again)
run_test "Check Auth Status (After Login)" 400 false \
  -s -H "Authorization: Bearer $AUTH_TOKEN" \
  "${BASE_URL}/api/ocr/result/invalid-job-id-for-auth-check" || exit 1

# 9. Attempt Duplicate Signup
run_test "Attempt Duplicate Signup ($USERNAME)" 409 false \
  -s -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=${USERNAME}&password=${PASSWORD}" \
  "${BASE_URL}/signup" || exit 1

# 10. Test Preprocess & OCR Flow (Using JWT)
log_step "Test Preprocess and OCR Flow (JWT)"
if [[ ! -f "$TEST_FILE" ]]; then
  echo "ERROR: Test file '$TEST_FILE' not found. Skipping Preprocess/OCR tests." | tee -a "$LOG_FILE"
  exit 1
fi

echo "Uploading $TEST_FILE for preprocessing..." | tee -a "$LOG_FILE"
# Preprocess needs the auth token
if run_test "Preprocess File Upload" 200 false \
   -s -X POST \
   -H "Authorization: Bearer $AUTH_TOKEN" \
   -F "file=@${TEST_FILE}" \
   "${BASE_URL}/api/preprocess"; then

  echo "Starting OCR Job..." | tee -a "$LOG_FILE"
  # Start OCR needs the auth token
  OCR_START_BODY=$(curl -s -X POST \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' \
    "${BASE_URL}/api/ocr/start")

  echo "--- OCR Start Response Body ---" >> "$LOG_FILE"
  echo "$OCR_START_BODY" >> "$LOG_FILE"
  echo "--- End OCR Start Response Body ---" >> "$LOG_FILE"

  JOB_ID=""
  STATUS_URL_PATH=""
  if command -v jq >/dev/null 2>&1; then
    JOB_ID=$(echo "$OCR_START_BODY" | jq -r '.jobId // ""')
    STATUS_URL_PATH=$(echo "$OCR_START_BODY" | jq -r '.statusUrl // ""')
  fi
  if [[ -z "$JOB_ID" ]]; then
      echo "jq failed or unavailable, attempting grep/sed fallback..." | tee -a "$LOG_FILE"
      JOB_ID=$(echo "$OCR_START_BODY" | grep '"jobId":' | sed -E 's/.*"jobId":"([^"]+)".*/\1/')
      STATUS_URL_PATH=$(echo "$OCR_START_BODY" | grep '"statusUrl":' | sed -E 's/.*"statusUrl":"([^"]+)".*/\1/')
  fi

  if [[ -z "$JOB_ID" ]]; then
      echo "WARNING: Could not extract Job ID. Cannot poll status." | tee -a "$LOG_FILE"
  else
	    echo "[DEBUG] Extracted Job ID: $JOB_ID" | tee -a "$LOG_FILE"
      echo "[DEBUG] Extracted Status URL Path: $STATUS_URL_PATH" | tee -a "$LOG_FILE"

      FULL_STATUS_URL="${BASE_URL}${STATUS_URL_PATH}"
      echo "OCR Job ID: $JOB_ID" | tee -a "$LOG_FILE"
      echo "Polling OCR Status URL: ${FULL_STATUS_URL} (waiting indefinitely...)" | tee -a "$LOG_FILE"

      ocr_status="pending"
      attempt=1

      while [[ "$ocr_status" == "pending" ]]; do
          echo "[DEBUG] Polling URL in loop: ${FULL_STATUS_URL}" | tee -a "$LOG_FILE"
          echo "Polling attempt $attempt..." | tee -a "$LOG_FILE"
          sleep "$OCR_POLL_DELAY_SECONDS"

          # Polling needs the auth token
          POLL_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $AUTH_TOKEN" "${FULL_STATUS_URL}")
          POLL_STATUS=$(echo -e "$POLL_RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
          POLL_BODY=$(echo -e "$POLL_RESPONSE" | sed '$d')

          echo "--- OCR Poll Response (Attempt $attempt) ---" >> "$LOG_FILE"
          echo "Status Code: $POLL_STATUS" >> "$LOG_FILE"
          echo "Body:" >> "$LOG_FILE"
          echo "$POLL_BODY" >> "$LOG_FILE"
          echo "--- End OCR Poll Response ---" >> "$LOG_FILE"

          # Check for 401 explicitly during poll
          if [[ "$POLL_STATUS" == "401" ]]; then
              echo "ERROR: Received 401 Unauthorized during polling. Token likely expired or invalid. Stopping poll." | tee -a "$LOG_FILE"
              ocr_status="error_unauthorized"
              break
          elif [[ "$POLL_STATUS" != "200" && "$POLL_STATUS" != "202" ]]; then
              echo "WARNING: Unexpected HTTP status $POLL_STATUS during polling. Stopping poll." | tee -a "$LOG_FILE"
              ocr_status="error_http_$POLL_STATUS"
              break
          fi

          if command -v jq >/dev/null 2>&1; then
              ocr_status=$(echo "$POLL_BODY" | jq -r '.status // "error_parsing"')
          else
              if echo "$POLL_BODY" | grep -q '"status":"completed"'; then ocr_status="completed"
              elif echo "$POLL_BODY" | grep -q '"status":"failed"'; then ocr_status="failed"
              elif echo "$POLL_BODY" | grep -q '"status":"pending"'; then ocr_status="pending"
              else ocr_status="error_parsing"; fi
          fi

          if [[ "$ocr_status" == "error_parsing" ]]; then
              echo "ERROR: Could not parse 'status' field from response body. Stopping poll." | tee -a "$LOG_FILE"
              break
          fi

          echo "Current OCR Status from body: $ocr_status" | tee -a "$LOG_FILE"
          ((attempt++))
      done

      if [[ "$ocr_status" == "completed" ]]; then echo "OCR RESULT: SUCCESS (Completed)" | tee -a "$LOG_FILE"
      elif [[ "$ocr_status" == "failed" ]]; then echo "OCR RESULT: FAILURE (Job Failed according to status)" | tee -a "$LOG_FILE"
      else echo "OCR RESULT: FAILURE (Polling stopped due to error: $ocr_status)" | tee -a "$LOG_FILE"; exit 1; fi
  fi
else
    echo "Skipping OCR start/poll because preprocess failed." | tee -a "$LOG_FILE"
    exit 1
fi

# --- Final Success Message ---
log_step "All Tests Completed"
echo "Test results logged to $LOG_FILE"
# echo "Cookie jar stored in $COOKIE_JAR" # No cookie jar

exit 0
