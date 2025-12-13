# Git Merge Conflict Resolution Skill

An intelligent AI-powered tool that resolves complex git merge conflicts by understanding the semantic intent behind code changes, not just the textual differences.

## What This Skill Does

This skill acts as an **expert Git Merge Conflict Orchestrator** that:

- **Automatically detects** merge conflicts in your repository
- **Analyzes semantic intent** by examining commit messages and code changes
- **Intelligently merges** conflicting changes by understanding what each branch was trying to accomplish
- **Verifies syntax** of resolved files to ensure code validity
- **Guides you step-by-step** through the entire conflict resolution process

Unlike traditional merge tools that only show you textual differences, this skill understands programming logic and can synthesize changes from both branches to produce code that satisfies both sets of requirements.

## How It Works

### The Intelligence Behind Resolution

1. **Three-Way Diff Analysis**: Extracts the base (common ancestor), local (your changes), and remote (incoming changes) versions of each conflicted file

2. **Semantic Intent Detection**: Reads commit messages to understand *why* changes were made on each branch, not just *what* changed

3. **Logic Synthesis**: Intelligently combines changes by:
   - Distinguishing structural changes (renaming, refactoring) from functional changes (new logic, behavior)
   - Adapting one branch's logic to another branch's structural changes
   - Combining additive changes when both branches add new constraints
   - Choosing between conflicting values based on commit context

4. **Code Integrity Validation**: Ensures the final output is syntactically valid and includes all necessary imports

## How to Use This Skill

### Prerequisites

- You must be in a git repository with active merge conflicts
- Python 3 must be available on your system
- The `git_tools.py` script must be present in your working directory

### Basic Workflow

**1. Start the conversation**
```
Hello
```
The AI will greet you and suggest typing `scan` to begin.

**2. Scan for conflicts**
```
scan
```
This lists all files with merge conflicts.

**3. Resolve a specific file**
```
resolve filename.py
```
The AI will analyze the conflict and present a fully merged version of the file.

**4. Apply the resolution**
```
apply
```
This writes the resolved content to disk and verifies syntax.

**5. Mark as resolved in git**
```bash
git add filename.py
```
You must manually run this command to tell git the conflict is resolved.

**6. Continue with remaining conflicts**
```
scan
```
Repeat the process for other conflicted files.

### Available Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `scan` | find conflicts, list, status | Lists all files with merge conflicts |
| `resolve <file>` | solve, fix, extract | Analyzes and resolves conflicts in the specified file |
| `apply` | yes, save, confirm | Saves the resolved content and verifies syntax |
| `help` | info, commands | Shows available commands and workflow |

### Example Session

```
User: hi
AI: Hello! Welcome to the Git Merge Conflict Resolver. Type 'help' to see available 
    commands, or type 'scan' to begin analyzing conflicts.

User: scan
AI: Found 2 conflicted files:
    • src/app.py (UU)
    • config/settings.py (UU)
    
    To start resolving, type: resolve src/app.py

User: resolve src/app.py
AI: [Analyzes the file and presents merged code]
    
    Review the code above. If it looks correct, type 'apply' to save it.

User: apply
AI: ✓ File written successfully
    ✓ Syntax verified: Python syntax check passed
    
    Please run `git add src/app.py` manually to mark it resolved, then type 'scan' to check for remaining conflicts.
```

## Resolution Strategies

The AI uses several intelligent strategies to resolve conflicts:

### 1. Structural vs. Functional Changes
- **Structural**: Renaming variables, moving functions, reformatting
- **Functional**: New logic, different values, behavior changes

If one branch renames a variable and another modifies its logic, the AI applies the logic to the new name.

### 2. Additive Merging
When both branches add new functionality (new imports, new conditions, new checks), the AI combines them unless they're mutually exclusive.

### 3. Conflict Precedence
For direct conflicts (same value changed to different things), the AI examines commit messages to determine which change reflects the more recent policy or intent.

### 4. Import Consolidation
Ensures all necessary imports from both versions are included in the final file.

## Limitations

### Current Constraints

1. **Language Support**: Syntax verification currently only works for **Python files**. Other languages are assumed valid.

2. **Manual Git Operations**: You must still manually run `git add <file>` after applying changes.

3. **Complex Business Logic**: The AI makes its best judgment based on code structure and commit messages, but cannot understand complex business requirements or domain-specific rules.

4. **Binary Files**: Cannot resolve conflicts in binary files (images, compiled code, etc.).

5. **Requires Context**: Works best when commit messages are descriptive. Poor commit messages ("fixed stuff", "updates") reduce resolution accuracy.

### When Human Review is Essential

- **Security-sensitive code**: Always review changes to authentication, authorization, or cryptographic code
- **Database migrations**: Schema changes require careful human oversight
- **API contracts**: Changes to public APIs need manual verification
- **Configuration values**: Production settings should be manually confirmed

## Best Practices

### For Optimal Results

1. **Write descriptive commit messages**: Clear messages help the AI understand intent
   - Poor example: "updates"
   - Good example: "Refactored authentication to use JWT tokens"

2. **Review before applying**: Always review the proposed resolution before typing `apply`

3. **Test after resolution**: Run your test suite after resolving conflicts

4. **Resolve one file at a time**: Don't rush through multiple files without verification

5. **Keep git_tools.py accessible**: Ensure the script is in your working directory

### Troubleshooting

**"File not found" error**: Make sure you're in the git repository root

**"No conflicts found"**: Run `git status` to verify you're in a merge state

**Syntax errors after resolution**: The AI will detect these and offer to fix them, or you can manually edit the file

**Unexpected resolution**: Provide feedback and manually adjust the code. The AI learns from descriptive commit messages.

## Getting Help

- Type `help` at any time to see available commands
- The AI will always guide you on the next step
- If stuck, start over with `scan` to see the current state

## Contributing

This skill improves with better commit message analysis and expanded language support. Future enhancements may include:
- JavaScript/TypeScript syntax verification
- Automatic git add after successful resolution
- Interactive conflict resolution for ambiguous cases
- Machine learning from user feedback on resolutions

---

**Remember**: This tool is designed to assist, not replace human judgment. Always review critical changes, especially in production code.