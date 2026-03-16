import os
import subprocess
import sys
from pathlib import Path
from dotenv import load_dotenv

def main():
    # Load environment variables from .env
    env_path = Path(__file__).resolve().parent.parent / '.env'
    if not env_path.exists():
        print(f"Error: .env file not found at {env_path}")
        sys.exit(1)
        
    load_dotenv(env_path)
    
    # Get configuration from environment
    data_bucket = os.getenv("GCP_DATA_BUCKET_NAME")
    
    if not data_bucket:
        print("Error: GCP_DATA_BUCKET_NAME not set in .env")
        sys.exit(1)

    print(f"--- Syncing Local Data to Google Cloud Storage ---")
    print(f"Target Bucket: gs://{data_bucket}")
    print("-" * 50)

    # Make sure we're syncing from the correct 'data' folder
    project_root = Path(__file__).resolve().parent.parent
    data_dir = project_root / "data"

    if not data_dir.exists():
        print(f"Error: Local 'data' directory not found at {data_dir}")
        sys.exit(1)

    print(f"\nSyncing {data_dir} -> gs://{data_bucket}...")

    cmd = [
        "gsutil", "-m", "rsync", "-r",
        str(data_dir),
        f"gs://{data_bucket}"
    ]

    try:
        # Run the command and stream output to terminal
        is_windows = os.name == 'nt'
        subprocess.run(cmd, check=True, shell=is_windows)
        print("\nSync completed successfully!")
    except subprocess.CalledProcessError as e:
        print(f"\nSync failed with exit code {e.returncode}")
        sys.exit(e.returncode)
    except FileNotFoundError:
        print("\nError: 'gsutil' command not found. Please ensure Google Cloud CLI is installed.")
        sys.exit(1)

if __name__ == "__main__":
    main()
