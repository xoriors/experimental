# Git Merge Conflict Resolution Skill for AI Agents

This repository contains a modular skill designed to enable AI agents (specifically within the Claude Code environment) to autonomously and accurately resolve git merge conflicts.

While Large Language Models are proficient at writing code, they often struggle with the syntax of standard git merge markers (`<<<<<<<`, `=======`, `>>>>>>>`) due to a lack of context regarding the conflicting branches. This project bridges that gap by providing the agent with executable tools to retrieve the full history of the conflict (Base, Local, Remote) and a strict set of operational guidelines.

## Architecture Overview

The solution relies on a "Tool-Use" pattern where the agent acts not just as a text processor but as an orchestrator. It uses local Python scripts to interact with the Git CLI, processes the data, and applies resolution logic based on a predefined educational context.

## Repository Structure & File Descriptions

To implement this skill effectively, the project requires the following file structure. Each file serves a specific role in the agent's decision-making loop.

### 1. `instructions.md` (The Educational Layer)
This file acts as the system prompt or "knowledge base" for the agent. It dictates the behavior and decision-making process. It does not contain code to be executed, but rather the logic the agent must follow.

* **Purpose:** Teaches the agent the "Algorithm of Resolution."
* **Key Contents:**
    * **Step-by-Step Workflow:** Instructions to identify conflicts, fetch raw data, analyze intent, and apply fixes.
    * **Conflict Strategies:** Rules for handling specific scenarios (e.g., "If *Local* changes variable names and *Remote* changes logic, keep both").
    * **Import Handling:** Specific instructions to perform a union of imports rather than overwriting them.
    * **Fallbacks:** Directives on what to do when code intent is ambiguous (e.g., defaulting to HEAD and adding a TODO comment).

### 2. `git_tools.py` (The Execution Layer)
This Python script serves as the bridge between the AI agent and the local Git repository. The agent calls functions within this file to gather factual data about the state of the codebase.

* **Purpose:** Provides deterministic, structured data to the LLM.
* **Key Functions:**
    * `list_conflicted_files()`: Parses `git status --porcelain` to identify files requiring attention.
    * `get_three_way_diff(filepath)`: Uses `git show` to extract the three versions of the truth:
        * **:1 (Base):** The common ancestor.
        * **:2 (Ours):** The local changes (HEAD).
        * **:3 (Theirs):** The incoming changes.
    * `validate_syntax(filepath)`: A utility to run language-specific linters (e.g., `ast` for Python) to ensure the resolved code is syntactically valid before staging.

### 3. `resolution_template.md` (Optional)
A template file used by the agent to structure its reasoning before editing the code.

* **Purpose:** Forces the agent to output a "Chain of Thought" before writing code.
* **Structure:**
    * Conflict Summary.
    * Detected Intent (Local vs. Remote).
    * Proposed Resolution Strategy.

## Operational Workflow

When the agent is tasked with fixing a merge conflict, the expected execution flow is:

1.  **Context Loading:** The agent reads `instructions.md` to understand its role and constraints.
2.  **Discovery:** The agent executes `python git_tools.py --list` to find the target files.
3.  **Data Extraction:** For every conflict, the agent executes `python git_tools.py --extract <filename>`. It receives a structured object containing the Base, Ours, and Theirs content.
4.  **Logic Synthesis:** The agent compares the three versions. Instead of guessing based on conflict markers, it reconstructs the valid code path based on the logic defined in the instructions.
5.  **Application:** The agent rewrites the file content locally.
6.  **Verification:** The agent executes `python git_tools.py --verify <filename>` to catch syntax errors.