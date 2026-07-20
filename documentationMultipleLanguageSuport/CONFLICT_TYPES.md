# Git Merge Conflict Types - Multi-Language Reference

This document categorizes common types of merge conflicts across different programming languages and provides resolution strategies for AI agents.

---

## Conflict Classification System

Each conflict is assigned a **difficulty score (1-5)** that determines whether the agent should:
- **1-2 (Trivial):** Auto-resolve without user input
- **3 (Moderate):** Auto-resolve with confidence indicators
- **4 (Complex):** Present options to user
- **5 (Critical):** Always require user decision

---

## Language-Agnostic Conflicts

These patterns appear across all languages:

### 1. Whitespace Conflicts (Difficulty: 1)

**Description:** Differences only in spaces, tabs, or newlines.

**Example:**
```python
<<<<<<< HEAD
def hello():
    print("world")
=======
def hello():
	print("world")  # Tab instead of spaces
>>>>>>> branch
```

**Resolution Strategy:**
- Normalize to project style (detect from `.editorconfig` or majority usage)
- If Python: always use spaces (PEP 8)
- If Go: always use tabs

**Auto-Resolve:**  Yes

---

### 2. Comment Conflicts (Difficulty: 1)

**Description:** Only comments differ between versions.

**Example:**
```javascript
<<<<<<< HEAD
// TODO: Refactor this function
=======
// FIXME: This needs optimization
>>>>>>> branch
function process() { ... }
```

**Resolution Strategy:**
- Merge both comments if they convey different information
- If duplicate meaning, keep the more actionable one

**Auto-Resolve:**  Yes

---

### 3. Import/Dependency Conflicts (Difficulty: 2)

**Description:** Different imports or dependencies added on each branch.

**Python Example:**
```python
<<<<<<< HEAD
import os
import sys
=======
import os
import json
>>>>>>> branch
```

**JavaScript Example:**
```javascript
<<<<<<< HEAD
import { useState } from 'react';
import axios from 'axios';
=======
import { useState } from 'react';
import fetch from 'node-fetch';
>>>>>>> branch
```

**Resolution Strategy:**
- **Union merge:** Include all unique imports
- Sort imports alphabetically (language convention)
- Remove duplicates
- Verify all imports are actually used in the resolved code

**Auto-Resolve:**  Yes (with verification)

---

### 4. Variable/Function Renaming (Difficulty: 3)

**Description:** One branch renames an identifier, the other modifies its usage.

**Example:**
```python
<<<<<<< HEAD
def calculate_total(items):
    return sum(items)
=======
def compute_sum(items):
    return sum(items)
>>>>>>> branch

# Elsewhere in the file:
result = calculate_total([1, 2, 3])  # Which name to use?
```

**Resolution Strategy:**
1. Detect rename pattern (same logic, different name)
2. Choose the new name from the branch that renamed
3. **Update all references** throughout the file
4. Verify no undefined references remain

**Auto-Resolve:** ⚠️ Conditional (if confident about rename scope)

---

### 5. Configuration Value Changes (Difficulty: 3)

**Description:** Both branches change the same config value.

**JSON Example:**
```json
{
<<<<<<< HEAD
  "timeout": 5000
=======
  "timeout": 10000
>>>>>>> branch
}
```

**YAML Example:**
```yaml
<<<<<<< HEAD
max_connections: 100
=======
max_connections: 200
>>>>>>> branch
```

**Resolution Strategy:**
- Check commit messages for rationale
- If one is a "hotfix" or "critical", prefer that value
- Otherwise, ask user which value to keep
- Suggest creating an environment variable instead

**Auto-Resolve:** ❌ No (user decision needed)

---

## Language-Specific Conflicts

### Python

#### Type Hints Conflict (Difficulty: 2)
```python
<<<<<<< HEAD
def process(data: dict) -> list:
=======
def process(data: Dict[str, Any]) -> List[str]:
>>>>>>> branch
```

**Resolution:** Prefer the more specific type hint (branch version).

#### Docstring Conflict (Difficulty: 2)
```python
<<<<<<< HEAD
"""Process data and return results."""
=======
"""
Process data with validation.

Args:
    data: Input dictionary

Returns:
    List of processed items
"""
>>>>>>> branch
```

**Resolution:** Keep the more detailed docstring.

---

### JavaScript/TypeScript

#### TypeScript Interface Conflict (Difficulty: 3)
```typescript
<<<<<<< HEAD
interface User {
  name: string;
  email: string;
}
=======
interface User {
  name: string;
  email: string;
  age?: number;
}
>>>>>>> branch
```

**Resolution:** Union merge (keep all properties). Mark new fields as optional.

#### React Component Props Conflict (Difficulty: 4)
```tsx
<<<<<<< HEAD
function Button({ onClick }: { onClick: () => void }) {
=======
function Button({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
>>>>>>> branch
```

**Resolution:** Union merge props, ensure new props have defaults.

---

### Go

#### Error Handling Pattern Conflict (Difficulty: 3)
```go
<<<<<<< HEAD
if err != nil {
    return err
}
=======
if err != nil {
    return fmt.Errorf("failed to connect: %w", err)
}
>>>>>>> branch
```

**Resolution:** Prefer wrapped errors (better debugging).

---

### Rust

#### Ownership/Borrow Conflict (Difficulty: 5)
```rust
<<<<<<< HEAD
fn process(data: Vec<String>) -> usize {
    data.len()
}
=======
fn process(data: &Vec<String>) -> usize {
    data.len()
}
>>>>>>> branch
```

**Resolution:** This requires semantic analysis. Prefer `&Vec` (borrowing) unless ownership transfer is needed. **Must verify borrow checker passes.**

---

## Logic Conflicts (All Languages)

### 6. Conditional Logic Merge (Difficulty: 4)

**Description:** Both branches add different conditions to the same block.

**Python Example:**
```python
<<<<<<< HEAD
if user.is_authenticated and user.has_permission:
    allow_access()
=======
if user.is_authenticated and not user.is_banned:
    allow_access()
>>>>>>> branch
```

**Resolution Strategy:**
- **Additive approach:** Combine conditions with `and`
- Result: `if user.is_authenticated and user.has_permission and not user.is_banned:`
- Verify logical consistency (no contradictions)

**Auto-Resolve:** ⚠️ Conditional (if intents align)

---

### 7. Algorithm Change Conflict (Difficulty: 5)

**Description:** Both branches implement different algorithms for the same function.

**Example:**
```python
<<<<<<< HEAD
def sort_items(items):
    return sorted(items)  # Quick sort
=======
def sort_items(items):
    # Bubble sort for stability
    for i in range(len(items)):
        for j in range(len(items)-i-1):
            if items[j] > items[j+1]:
                items[j], items[j+1] = items[j+1], items[j]
    return items
>>>>>>> branch
```

**Resolution Strategy:**
- **Cannot auto-merge** - fundamentally different approaches
- Present both implementations to user
- Suggest keeping both as separate functions (e.g., `sort_items_fast` vs `sort_items_stable`)

**Auto-Resolve:** ❌ Never

---

## Detection Patterns (For Agent Implementation)

The agent should detect conflict types using these heuristics:

### Whitespace Detection
```python
def is_whitespace_conflict(local, remote):
    return local.strip() == remote.strip()
```

### Import Detection
```python
def is_import_conflict(local, remote, language):
    patterns = {
        'python': r'^import |^from .* import',
        'javascript': r'^import .* from|^const .* = require',
        'go': r'^import \(',
    }
    local_is_import = re.match(patterns[language], local)
    remote_is_import = re.match(patterns[language], remote)
    return local_is_import and remote_is_import
```

### Rename Detection
```python
def is_rename_conflict(local, remote):
    # Check if structure is identical except for one identifier
    local_tokens = tokenize(local)
    remote_tokens = tokenize(remote)
    
    if len(local_tokens) != len(remote_tokens):
        return False
    
    differences = sum(1 for l, r in zip(local_tokens, remote_tokens) if l != r)
    return differences == 1  # Only one token differs
```

---

## Resolution Priority Rules

When multiple conflicts exist in a file, resolve in this order:

1. **Whitespace conflicts** (trivial)
2. **Comment conflicts** (trivial)
3. **Import conflicts** (can affect later resolutions)
4. **Rename conflicts** (affects variable references)
5. **Logic conflicts** (most complex)

---

## Agent Decision Tree

```
Is conflict whitespace-only?
├─ YES → Auto-normalize and resolve
└─ NO
    │
    Are both sides adding new imports?
    ├─ YES → Union merge imports
    └─ NO
        │
        Is it a rename + modification?
        ├─ YES → Apply rename everywhere
        └─ NO
            │
            Are commit messages clear?
            ├─ YES → Follow semantic intent
            └─ NO → Present options to user
```

---

## Language-Specific Import Sorting

### Python (PEP 8 Order)
1. Standard library imports
2. Related third-party imports
3. Local application imports

```python
import os
import sys

import numpy as np
import pandas as pd

from .models import User
```

### JavaScript/TypeScript
1. External packages
2. Internal packages
3. Relative imports

```javascript
import React from 'react';
import axios from 'axios';

import { API_URL } from '@/config';

import './styles.css';
```

### Go
- Group standard library, then external packages
- Use `goimports` tool for automatic sorting

---

## Testing Conflict Resolution

Create test scenarios for each conflict type:

```bash
# Setup test repo
git init test-conflicts
cd test-conflicts

# Create conflicting branches
git checkout -b feature-a
echo "version A" > file.txt
git commit -am "Change A"

git checkout main
echo "version B" > file.txt
git commit -am "Change B"

# Attempt merge
git merge feature-a  # Creates conflict

# Test agent resolution
python get_tools.py extract file.txt
# Agent analyzes and resolves...
```

---

## Future Enhancements

1. **Machine Learning Model:** Train on resolved conflicts to predict resolution strategy
2. **AST-Level Merging:** Parse code into AST, merge at semantic level
3. **Test-Driven Resolution:** Run tests for each resolution candidate
4. **Cross-Reference Detection:** Identify when changes in one file affect imports in another

---

## References

- [Google Sheet - Conflict Types](https://docs.google.com/spreadsheets/d/1cT7eUNmxuOgy26hpWKud_L2dnhitMGqS2d6XJF2SJ4A/)
- Git Documentation: [How Conflicts Are Presented](https://git-scm.com/docs/git-merge#_how_conflicts_are_presented)
- [Semantic Merge Paper (2011)](https://www.semanticmerge.com/)