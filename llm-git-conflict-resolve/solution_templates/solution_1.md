# Git Merge Conflict Prompt for AI Agents

This project defines a skill for the Claude Code Agent, designed to detect and resolve Git merge conflicts. The skill provides clear instructions, well‑defined procedures, and auxiliary tools to help the agent interpret files containing conflicts and generate a correct final version without conflict markers.

## Objective

The goal of the skill is to provide a complete set of instructions enabling an AI agent to:

- Detect conflicts in files.
- Identify the structure of Git markers (`<<<<<<<`, `=======`, `>>>>>>>`).
- Extract the conflicting sections.
- Analyze differences between HEAD and branch versions.
- Apply various merge strategies (automatic, HEAD‑first, branch‑first, semantic).
- Call auxiliary Python code for more advanced analysis.
- Generate a coherent final resolution.
- Rewrite the final file without conflict markers.

The agent **does not use real Git commands**. All operations are based exclusively on text processing according to the instructions in this skill.

---

# Skill Contents

The skill consists of three main components: the logic file (`skill.md`), the auxiliary script (`merge_utils.py`), and the usage documentation (`usage.md`).

## 1. `skill.md` – Main Instructions

This file defines the agent’s behavior and the rules it must follow when resolving conflicts.

### What it contains

- Description of the skill’s purpose.
- Explanation of mandatory operational steps.
- Clear definition of how to detect and extract conflicts.
- Rules for analyzing and applying merge strategies.
- Instructions on how to use the auxiliary Python code.
- Sample inputs and outputs to guide the agent.

### Operational steps

1. Identify conflict markers:
   ```
   <<<<<<< HEAD
   ...
   =======
   ...
   >>>>>>> branch
   ```
2. Extract the two sections into this structure:
   ```json
   {
       "HEAD": "...",
       "branch": "..."
   }
   ```
3. Analyze the differences between the two sections.
4. Apply a merge strategy based on instructions and context.
5. Generate a final resolved version.
6. If necessary, call the Python script (`merge_utils.py`) for:
   - conflict detection,
   - advanced comparisons,
   - semantic analysis.
7. Interpret the JSON output returned by the script.
8. Reconstruct the final file without conflict markers.

### Documented merge strategies

- **Automatic strategy**: if one version is contained in the other.
- **HEAD‑first strategy**: keep the HEAD version.
- **Branch‑first strategy**: keep the branch version.
- **Semantic merge**:
  - reconstruct JSON,
  - combine functions in code when changes are not conflicting.
- **Assisted merge**: the agent asks the user for explicit selection.

### Examples

The skill includes examples of conflicts and their correct resolutions so that the agent understands the expected format.

---

## 2. `merge_utils.py` – Auxiliary Python Code

This script is used for operations that are more efficient or safer when executed as local Python code. The agent may explicitly call it during the merge process.

### Possible functionalities

- `detect_conflicts(file_text)` identifies all conflicting sections in a file and returns a JSON structure.
- `three_way_merge(base, ours, theirs)` implements a three‑way merge.
- `ast_merge_python(ours, theirs)` performs a semantic merge of Python functions.
- `json_merge(ours, theirs)` safely combines JSON structures.
- `line_similarity(a, b)` returns a similarity score between lines for automated decisions.

### Recommended output format

```json
{
  "conflicts": [
    {
      "start_line": 42,
      "end_line": 68,
      "HEAD": "...",
      "branch": "...",
      "type": "text"
    }
  ]
}
```

---

## 3. `usage.md` – Usage Documentation

The `usage.md` file explains the correct way to use the skill, for both the agent and the user.

### Contents

- Instructions on how to call the Python script.
- Accepted input formats.
- How to interpret output.
- Complete examples of usage.
- Conventions between agent and script (CLI arguments, JSON structures, etc.).

---

# Conclusion

The skill provides a complete methodology for resolving Git merge conflicts without using Git directly. The documentation in `skill.md` serves as the operational guide for the agent, `merge_utils.py` provides advanced technical support, and `usage.md` clarifies how to interact with the skill. This set of files enables the agent to efficiently detect, interpret, and combine conflicting sections, producing a clean and coherent final version.
