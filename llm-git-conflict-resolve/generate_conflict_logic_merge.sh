#!/bin/bash

# Setup script for Git merge conflict demo (Scenario: Logic Merge)
# Conflict: Price Update (Local) vs Stock Check (Remote)

# 1. Create directory
mkdir -p conflict-logic-merge
cd conflict-logic-merge

# 2. Initialize git quietly
git init -q
git config user.email "dev@example.com"
git config user.name "Dev User"

# 3. Copy tools and setup GEMINI.md
if [ -d "../skill" ]; then
    cp ../skill/git_tools.py .
    cp ../skill/instructions.md GEMINI.md
else
    echo "Error: '../skill' directory not found."
    exit 1
fi

# 4. Base Commit
cat > products.py << 'EOF'
import sys

def filter_products(products):
    """
    Filters a list of products based on basic criteria.
    Current rule: Only cheap products under $100.
    """
    valid_products = []
    for p in products:
        if p['price'] < 100:
            valid_products.append(p)
    return valid_products
EOF

git add products.py
git commit -q -m "Initial commit"

# 5. Remote Branch (Feature): Add Stock Check & Logging
git checkout -q -b feature-stock
cat > products.py << 'EOF'
import sys
import logging

def filter_products(products):
    """
    Filters products: cheap AND in stock.
    """
    valid_products = []
    for p in products:
        if p['price'] < 100 and p['in_stock'] is True:
            valid_products.append(p)
        else:
            logging.info(f"Skipping product: {p['id']}")
    return valid_products
EOF

git commit -a -q -m "Feature: Add stock check validation"

# 6. Local Branch (Master): Update Price Policy (Inflation)
git checkout -q master
cat > products.py << 'EOF'
import sys
import math

def filter_products(products):
    """
    Filters a list of products based on basic criteria.
    Updated rule: Adjusted for inflation, limit is now $150.
    """
    valid_products = []
    for p in products:
        if p['price'] < 150:
            valid_products.append(p)
    return valid_products
EOF

git commit -a -q -m "Policy Update: Increase price limit to $150"

# 7. Create Conflict
git merge feature-stock --no-edit > /dev/null 2>&1 || true

echo "=================================="
echo "Conflicted Repo Ready (Logic Conflict)"
echo "Folder: conflict-logic-merge/"
echo "To start: cd conflict-logic-merge && gemini"
echo "=================================="