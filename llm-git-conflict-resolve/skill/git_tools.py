import sys
import argparse
import subprocess
import json
import os
import ast

def run_git_command(command):
    """Executes a git command and returns the output as a string."""
    try:
        result = subprocess.check_output(
            command, 
            stderr=subprocess.STDOUT, 
            shell=True
        )
        return result.decode('utf-8').strip()
    except subprocess.CalledProcessError as e:
        # Return None to signal that, for example, the file does not exist in that version
        return None

def list_conflicted_files():
    """Identifies files marked as conflicted."""
    # --porcelain provides a stable format for parsing
    output = run_git_command("git status --porcelain")
    if not output:
        return []

    conflicted_files = []
    for line in output.split('\n'):
        # Conflicts are usually marked with 'UU', 'AA', 'UD', etc.
        # The first 2 characters indicate the status
        status = line[:2]
        filepath = line[3:].strip()
        
        # Simplified filter: if both sides modified (U) or added (A)
        if 'U' in status or 'A' in status:
            conflicted_files.append({
                "filepath": filepath,
                "status": status
            })
    
    return conflicted_files

def get_file_content_at_stage(filepath, stage):
    """
    Extracts file content at a specific git stage.
    Stage 1 = Base (Ancestor)
    Stage 2 = Ours (Local/HEAD)
    Stage 3 = Theirs (Remote/MERGE_HEAD)
    """
    # git show :<stage>:<filepath>
    content = run_git_command(f"git show :{stage}:{filepath}")
    return content if content is not None else ""

def get_commit_context(filepath):
    """
    Extracts commit messages to understand semantic intent (Solution 3).
    """
    # HEAD is the current branch (Local)
    local_msg = run_git_command(f"git log -1 --pretty=%B HEAD -- {filepath}")
    
    # MERGE_HEAD is the incoming branch (Remote). 
    # It might be null if we are not in a standard merge, but we handle the case.
    remote_msg = run_git_command(f"git log -1 --pretty=%B MERGE_HEAD -- {filepath}")
    
    return {
        "local_intent": local_msg.strip() if local_msg else "Unknown (Manual changes or no commit msg)",
        "remote_intent": remote_msg.strip() if remote_msg else "Unknown (No MERGE_HEAD found)"
    }

def verify_syntax(filepath):
    """
    Verifies file syntax. Currently supports Python via AST.
    Can be extended for JS/TS by running 'node -c' etc.
    """
    if not os.path.exists(filepath):
        return {"status": "error", "message": "File not found"}

    # File extension
    _, ext = os.path.splitext(filepath)

    if ext == '.py':
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                source = f.read()
            ast.parse(source)
            return {"status": "valid", "message": "Python syntax check passed."}
        except SyntaxError as e:
            return {
                "status": "error", 
                "message": f"Syntax Error on line {e.lineno}: {e.msg}",
                "details": str(e)
            }
    
    # For other files, currently return valid (or implement specific linters)
    return {"status": "valid", "message": f"No linter configured for {ext}, assuming valid."}

def main():
    parser = argparse.ArgumentParser(description="Git Merge Conflict Tool for AI Agents")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # --- Command: list ---
    subparsers.add_parser("list", help="List conflicted files")

    # --- Command: extract ---
    extract_parser = subparsers.add_parser("extract", help="Extract content and context")
    extract_parser.add_argument("filepath", type=str, help="Path to the conflicted file")

    # --- Command: verify ---
    verify_parser = subparsers.add_parser("verify", help="Verify syntax")
    verify_parser.add_argument("filepath", type=str, help="Path to the file to verify")

    args = parser.parse_args()

    # Command routing
    if args.command == "list":
        result = list_conflicted_files()
        print(json.dumps(result, indent=2))

    elif args.command == "extract":
        filepath = args.filepath
        
        # 1. Extract Diff (Code)
        diff_data = {
            "base": get_file_content_at_stage(filepath, 1),
            "local": get_file_content_at_stage(filepath, 2),
            "remote": get_file_content_at_stage(filepath, 3)
        }
        
        # 2. Extract Context (Intent)
        context_data = get_commit_context(filepath)

        # 3. Build the complete payload
        full_payload = {
            "file": filepath,
            "diff": diff_data,
            "context": context_data,
            "note": "Use 'context' to determine intent, then merge 'diff' accordingly."
        }
        print(json.dumps(full_payload, indent=2))

    elif args.command == "verify":
        result = verify_syntax(args.filepath)
        print(json.dumps(result, indent=2))

    else:
        # If no command is provided
        parser.print_help()

if __name__ == "__main__":
    main()