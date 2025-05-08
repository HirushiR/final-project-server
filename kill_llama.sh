#!/bin/bash

# --- Configuration ---
PROCESS_NAME="llama-server"
FORCE_KILL=false

# --- Argument Parsing ---
# Only check for the force flag
if [[ "$1" == "-f" || "$1" == "--force" ]]; then
    FORCE_KILL=true
fi

# --- Find Processes ---
echo "Searching for running '$PROCESS_NAME' processes..."
# Use pgrep to get PIDs directly. -f matches full command line.
# Exclude pgrep itself and this script.
mapfile -t PIDS < <(pgrep -af "$PROCESS_NAME" | grep -v " pgrep " | grep -v " kill_llama.sh" | awk '{print $1}')

if [[ ${#PIDS[@]} -eq 0 ]]; then
    echo "No relevant '$PROCESS_NAME' processes found."
    exit 0
fi

# --- Action based on Force Flag ---
if [ "$FORCE_KILL" = true ]; then
    echo "Force kill option detected. Targeting ${#PIDS[@]} found processes with SIGKILL..."
    killed_count=0
    for pid in "${PIDS[@]}"; do
         # Check if PID exists before killing
        if kill -0 "$pid" &>/dev/null; then
            echo "  - Sending SIGKILL forcefully to PID: $pid"
            kill -KILL "$pid" &>/dev/null # Force kill directly
            # Brief pause for OS
            sleep 0.1
            if kill -0 "$pid" &>/dev/null; then
                 echo "    Warning: Process $pid might still exist after SIGKILL."
            else
                 echo "    Process $pid force-killed."
                 killed_count=$((killed_count + 1))
            fi
        else
             echo "  - Process $pid already gone. Skipping."
        fi
    done
    echo -e "\nFinished force kill attempt. $killed_count process(es) targeted."
    exit 0
else
    # If --force is not provided, just list the found processes and exit.
    # The graceful kill logic is now handled entirely by the Node.js caller.
    echo "Found the following relevant PIDs (run with --force to kill):"
     for pid in "${PIDS[@]}"; do
        # Optionally show command line for context if needed (more complex)
        # cmd=$(ps -o cmd= -p "$pid" | head -n 1)
        # echo "  - PID: $pid, Cmd: ${cmd:0:80}..."
        echo "  - PID: $pid"
     done
    echo "Exiting without action. Use --force flag to kill."
    exit 0 # Exit cleanly, indicating processes were found but not killed
fi