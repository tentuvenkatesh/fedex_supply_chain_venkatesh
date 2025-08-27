# Use Python base image
FROM python:3.11-slim

# Avoid bytecode + ensure instant logs
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Set working directory
WORKDIR /app

# System deps (optional but nice for scientific libs; slim usually works without)
# RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*

# Copy requirements first (better layer caching)
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY . .

# Expose a default dev port (Render will inject $PORT anyway)
EXPOSE 8000

# Start Gunicorn; use Render's $PORT when present, else 8000 for local
CMD ["bash", "-lc", "gunicorn -w 2 -k gthread -b 0.0.0.0:${PORT:-8000} app:app"]