# Git Merge Conflict Resolution Skill - Solution Design

## Core Philosophy

This skill treats merge conflict resolution as a **semantic understanding problem** rather than text manipulation. The agent reconstructs the complete 3-way evolution (Base → Ours, Base → Theirs) to understand *why* conflicts occurred, enabling intelligent reconciliation based on developer intent rather than pattern-matching on conflict markers.

## Approach

**Context Over Heuristics**: Extract full 3-way diffs, analyze commit messages, examine dependencies, and make decisions based on semantic code understanding.

**Progressive Resolution**: Address conflicts by difficulty—trivial (whitespace) → structural (imports) → logical (algorithms)—auto-resolving simple cases while escalating complex ones.

**Safety Through Validation**: Multi-layer verification (syntax, semantics, integration) with automatic backups before any modifications.

## Skill Structure

```
git-merge-conflict-skill/
├── instructions/
│   ├── 01-workflow.md              # Detection, prioritization, backup creation
│   ├── 02-context-extraction.md   # How to retrieve 3-way diffs and commit history
│   ├── 03-resolution-strategies.md # Decision trees for each conflict type
│   ├── 04-validation.md            # Post-resolution verification protocol
│   └── 05-escalation.md            # When and how to request human help
│
└── tools/
    ├── conflict_extractor.py       # Extract 3-way diffs and parse conflict markers
    ├── semantic_analyzer.py        # Analyze dependencies and infer intent
    ├── conflict_categorizer.py     # Classify conflict types automatically
    ├── resolution_validator.py     # Verify syntax and semantic correctness
    └── git_context.py              # Fetch commit history and branch metadata
```

### Instructions Layer (Markdown)

**Purpose**: Educate the agent on resolution logic—the "what to do" without executable code.

**01-workflow.md**: Teaches initial conflict detection, how to scan for conflicts, create backups, and prioritize resolution order (simple first).

**02-context-extraction.md**: Guides the agent through retrieving Base/Ours/Theirs versions, fetching commit messages from both branches, and understanding author intent through git blame.

**03-resolution-strategies.md**: Core decision logic organized by conflict type:
- **Imports**: Union merge, deduplicate, sort alphabetically
- **Whitespace**: Auto-resolve with project formatter
- **Renames**: Detect pattern, apply rename everywhere, keep other side's logic
- **Function signatures**: Check compatibility, merge if safe, escalate if breaking
- **Logic divergence**: Compare intents (bugfix vs feature), attempt combination or escalate with analysis
- **Refactoring**: Accept new structure, apply other side's changes to relocated code

**04-validation.md**: Multi-stage verification—syntax check (must pass), semantic check (undefined vars, type errors), integration check (works with surrounding code), plus test recommendations.

**05-escalation.md**: Clear criteria for requesting human help—ambiguous intent, data loss risk, test conflicts, complex dependencies. Defines escalation report format with detailed analysis and resolution options.

### Tools Layer (Python)

**Purpose**: Provide deterministic, structured data to the agent—the "how to fetch" without decision logic.

**conflict_extractor.py**: 
- Scans repository using `git status --porcelain`
- Extracts 3-way diff via git stages (`:1` base, `:2` ours, `:3` theirs)
- Parses conflict markers, returns structured blocks with surrounding context

**semantic_analyzer.py**:
- Maps code dependencies (what variables/functions are used)
- Detects rename patterns by comparing identifiers across versions
- Infers intent by analyzing commit messages and code changes
- Validates that resolved code satisfies its dependencies

**conflict_categorizer.py**:
- Automatically classifies conflicts (IMPORT, LOGIC, REFACTOR, etc.)
- Estimates difficulty (EASY, MEDIUM, HARD, ESCALATE)
- Provides initial assessment to guide strategy selection

**resolution_validator.py**:
- Language-specific syntax checking (AST parsing for Python, etc.)
- Semantic validation (undefined references, type mismatches)
- Runs project linters
- Suggests relevant tests based on changed code

**git_context.py**:
- Fetches commit messages that modified conflicted regions
- Finds merge base (common ancestor commit)
- Retrieves author info for escalation context
- Creates backup branches before resolution

## Resolution Workflow

```
DETECT → EXTRACT → CATEGORIZE → STRATEGIZE → RESOLVE → VALIDATE → COMMIT/ESCALATE
```

**For each conflict:**

1. **Extract Context**: Get 3-way diff, commit history, dependencies
2. **Categorize**: Classify type and difficulty using categorizer tool
3. **Select Strategy**: Match to decision tree in instructions
4. **Apply Resolution**: Generate resolved code based on strategy
5. **Validate**: Syntax → Semantics → Integration (must pass all)
6. **Finalize**: Stage if valid, escalate with detailed report if not

## Key Innovations

**Intent-Driven Resolution**: Analyzes commit messages + code semantics to understand the *goal* of each change, enabling intelligent merging of complementary features.

**Complete Context**: 3-way diff reveals full story (original → how each side changed → why), eliminating guesswork from conflict markers alone.

**Explicit Boundaries**: Clear escalation criteria prevent incorrect auto-resolutions while maximizing safe automation.

**Semantic Validation**: Beyond syntax, verifies resolved code makes semantic sense—no undefined variables, consistent types, satisfied dependencies.

**Progressive Complexity**: Sorts conflicts simple → complex, builds confidence on easy cases, bails early if complexity exceeds capabilities.

## Success Criteria

**Target auto-resolution rates**: 95% for trivial conflicts (imports, whitespace), 60% for structural (renames, refactors), 30% for logic conflicts.

**Quality**: Zero syntax errors through validation. <1% semantic errors through multi-layer checking. Clear escalation reports when human input needed.

**Safety-first**: Always backup before changes. Never commit invalid code. Escalate with detailed analysis when uncertain.