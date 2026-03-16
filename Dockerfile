# python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies needed for python packages if any
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy pyproject.toml
COPY pyproject.toml .

# Install dependencies using standard pip
# Since we are copying pyproject.toml, we can just install '.'
RUN pip install --no-cache-dir .

# Copy your application code
# We copy app, static, and templates
COPY app/ app/
COPY static/ static/
COPY templates/ templates/

# Create the data directory so the GCS mount has a target
RUN mkdir -p /app/data

# Ensure ADMIN_MODE is false for the public cloud run deployment
ENV ADMIN_MODE="false"

# Expose the port Cloud Run expects
EXPOSE 8080

# Command to run the application using Uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
