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
    project_id = os.getenv("GCP_PROJECT_ID")
    project_number = os.getenv("GCP_PROJECT_NUMBER")
    service_name = os.getenv("GCP_SERVICE_NAME", "casetes")
    region = os.getenv("GCP_REGION", "us-central1")
    data_bucket = os.getenv("GCP_DATA_BUCKET_NAME")
    
    if not project_id or not project_number:
        print("Error: GCP_PROJECT_ID or GCP_PROJECT_NUMBER not set in .env")
        sys.exit(1)
    if not data_bucket:
        print("Error: GCP_DATA_BUCKET_NAME not set in .env")
        sys.exit(1)

    print(f"--- Cloud Run Deployment (Python) ---")
    print(f"Project ID:     {project_id}")
    print(f"Project Number: {project_number}")
    print(f"Service Name:   {service_name}")
    print(f"Region:         {region}")
    print(f"Data Bucket:    {data_bucket}")
    print("-" * 37)

    is_windows = os.name == 'nt'

    # Step 1: Grant permissions to Cloud Run Service Account
    service_account = f"{project_number}-compute@developer.gserviceaccount.com"
    print(f"\nGranting '{service_account}' admin access to gs://{data_bucket}...")
    iam_cmd = [
        "gsutil", "iam", "ch",
        f"serviceAccount:{service_account}:objectAdmin",
        f"gs://{data_bucket}"
    ]
    try:
        subprocess.run(iam_cmd, check=True, shell=is_windows)
    except subprocess.CalledProcessError as e:
        print(f"\nWarning: Failed to set IAM policy (exit code {e.returncode}). Continuing anyway...")
    except FileNotFoundError:
        print("\nError: 'gsutil' command not found. Please ensure Google Cloud CLI is installed.")
        sys.exit(1)

    # Step 2: Construct the gcloud command for building and deploying
    print("\nExecuting deployment...")
    env_vars = f"ADMIN_MODE=false"

    cmd = [
        "gcloud", "run", "deploy", service_name,
        f"--project={project_id}",
        f"--region={region}",
        "--source=.",
        "--execution-environment=gen2",
        "--allow-unauthenticated",
        f"--add-volume=name=music-data,type=cloud-storage,bucket={data_bucket}",
        "--add-volume-mount=volume=music-data,mount-path=/app/data",
        f"--set-env-vars={env_vars}"
    ]

    try:
        # Run the command and stream output to terminal
        subprocess.run(cmd, check=True, shell=is_windows)
        print("\nDeployment successful!")
    except subprocess.CalledProcessError as e:
        print(f"\nDeployment failed with exit code {e.returncode}")
        sys.exit(e.returncode)
    except FileNotFoundError:
        print("\nError: 'gcloud' command not found.")
        sys.exit(1)

if __name__ == "__main__":
    main()
