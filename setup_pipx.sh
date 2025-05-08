#!/bin/bash

# --- Define Persistent Paths ---
# Adjust G DRIVE_BASE if your mount point is different
GDRIVE_BASE="/content/drive/MyDrive/ColabData"
PIPX_PATH="$GDRIVE_BASE/pipx_persistent"
PIPX_HOME_PATH="$PIPX_PATH/home"
PIPX_BIN_PATH="$PIPX_PATH/bin"

# --- Create Directories (using -p ensures they are created if missing, and doesn't error if they exist) ---
mkdir -p "$PIPX_HOME_PATH" && echo "Ensured PIPX_HOME directory exists: $PIPX_HOME_PATH"
mkdir -p "$PIPX_BIN_PATH" && echo "Ensured PIPX_BIN directory exists: $PIPX_BIN_PATH"

# --- Set and Export Environment Variables for pipx ---
# These tell pipx where to store environments and link executables
export PIPX_HOME="$PIPX_HOME_PATH"
export PIPX_BIN_DIR="$PIPX_BIN_PATH"
echo "Exported PIPX_HOME and PIPX_BIN_DIR"

# --- Add PIPX_BIN_DIR to PATH for the current session if not already present ---
# This allows you to run commands installed by pipx directly
# Check if the path is already present to avoid duplicates
# Using grep -q with delimiters is a robust way to check
echo ":$PATH:" | grep -q ":$PIPX_BIN_PATH:"
if [ $? -ne 0 ]; then
  export PATH="$PIPX_BIN_PATH:$PATH"
  echo "Added $PIPX_BIN_PATH to PATH for this session."
else
  echo "$PIPX_BIN_PATH already in PATH."
fi

# --- Verify (Optional) ---
echo "--- Current Environment ---"
echo "PIPX_HOME=$PIPX_HOME"
echo "PIPX_BIN_DIR=$PIPX_BIN_DIR"
echo "PATH=$PATH"
echo "---------------------------"
