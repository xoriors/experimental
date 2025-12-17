# extended on a minimal Linux OS with pre-installed python 3.12
FROM python:3.12-slim

# prevent python from writing .pyc files
ENV PYTHONDONTWRITEBYTECODE=1
# send print statements directly to terminal (logs)
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# copy and install libraries inside the container
COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# copy the rest of the structure into the /app folder
COPY . .

# listen on port 8000
EXPOSE 8000

# launch the web server
CMD ["uvicorn", "guard_server:app", "--host", "0.0.0.0", "--port", "8000"]