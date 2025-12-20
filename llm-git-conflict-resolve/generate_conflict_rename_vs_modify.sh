#!/bin/bash

# Setup script for Git merge conflict demo (Scenario: Rename vs Modify)

# 1. Create directory
mkdir -p conflict-rename-vs-modify
cd conflict-rename-vs-modify

# 2. Initialize git quietly
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

# 3. Copy tools and setup GEMINI.md
if [ -d "../skill" ]; then
    cp ../skill/git_tools.py .
    cp ../skill/instructions.md GEMINI.md
else
    echo "Error: '../skill' directory not found."
    exit 1
fi

# 4. Base Commit
cat > utils.py << 'EOF'
import os
import sys

def process_data(data):
    """Process the input data."""
    result = []
    for item in data:
        result.append(item * 2)
    return result

def calculate_sum(numbers):
    """Calculate sum of numbers."""
    total = 0
    for num in numbers:
        total += num
    return total
EOF

git add utils.py
git commit -q -m "Initial commit"

# 5. Remote Branch (Feature): Add logging & new function
git checkout -q -b feature
cat > utils.py << 'EOF'
import os
import sys
import json

def process_data(data):
    """Process the input data with enhanced logging."""
    result = []
    for item in data:
        print(f"Processing: {item}")
        result.append(item * 2)
    return result

def calculate_sum(numbers):
    """Calculate sum of numbers."""
    total = 0
    for num in numbers:
        total += num
    return total

def export_to_json(data, filename):
    """Export data to JSON file."""
    with open(filename, 'w') as f:
        json.dump(data, f, indent=2)
EOF

git commit -a -q -m "Feature: Add JSON export and logging"

# 6. Local Branch (Master): Rename functions
git checkout -q master
cat > utils.py << 'EOF'
import os
import sys

def transform_data(data):
    """Transform the input data (renamed from process_data)."""
    result = []
    for item in data:
        result.append(item * 2)
    return result

def sum_numbers(numbers):
    """Calculate sum of numbers (renamed from calculate_sum)."""
    total = 0
    for num in numbers:
        total += num
    return total
EOF

git commit -a -q -m "Refactor: Rename functions"

# 7. Create Conflict
git merge feature --no-edit > /dev/null 2>&1 || true

echo "=================================="
echo "Conflicted Repo Ready (Rename vs Modify)"
echo "Folder: conflict-rename-vs-modify/"
echo "To start: cd conflict-rename-vs-modify && gemini"
echo "=================================="