import subprocess
import sys


def main():
    command = ["watch", "-n", "1", "nvidia-smi"]
    print(f"Running: {' '.join(command)}")
    try:
        # Run and inherit stdio, wait for completion (or interrupt)
        process = subprocess.run(command, check=False)
        print(f"\nWatch exited with code: {process.returncode}")
        sys.exit(process.returncode)
    except FileNotFoundError:
        print("Error: 'watch' or 'nvidia-smi' command not found.", file=sys.stderr)
        print(
            "Please ensure 'watch' and NVIDIA drivers/tools are installed and in your PATH.",
            file=sys.stderr,
        )
        sys.exit(1)
    except Exception as e:
        print(f"An error occurred: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
