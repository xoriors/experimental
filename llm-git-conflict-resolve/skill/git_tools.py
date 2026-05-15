import sys
import argparse
import subprocess
import json
import os
import ast
import shutil
import re
import shlex

def run_git_command(command):
    """Executes a git command and returns the output as a string."""
    try:
        result = subprocess.check_output(
            shlex.split(command),
            stderr=subprocess.STDOUT
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
        
        # Only exact two-character conflict statuses (avoids staged-but-not-conflicted false positives)
        if status in {'UU', 'AA', 'AU', 'UA', 'DD', 'DU', 'UD'}:
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
    content = run_git_command(f"git show :{stage}:{shlex.quote(filepath)}")
    return content if content is not None else ""

def parse_and_summarize_ai_context(commit_message):
    """
    Searches for @ai-context and returns ONLY the path.
    The actual reading and summarization will be delegated to a Sub-Agent 
    as defined in the system instructions.
    """
    if not commit_message:
        return None

    # Search for the @ai-context <path> pattern
    match = re.search(r'@ai-context\s+([^\s]+)', commit_message)
    if match:
        repo_root = run_git_command("git rev-parse --show-toplevel") or ""
        context_path = os.path.abspath(match.group(1))
        if os.path.exists(context_path) and context_path.startswith(repo_root + os.sep):
            return context_path

    return None

def get_commit_context(filepath):
    """
    Extracts commit messages and identifies AI reasoning context paths.
    """
    # 1. Extract commit messages from Git
    local_msg = run_git_command(f"git log -1 --pretty=%B HEAD -- {shlex.quote(filepath)}")
    remote_msg = run_git_command(f"git log -1 --pretty=%B MERGE_HEAD -- {shlex.quote(filepath)}")
    
    # Ensure we have clean strings
    local_msg = local_msg.strip() if local_msg else "Unknown (Manual changes or no commit msg)"
    remote_msg = remote_msg.strip() if remote_msg else "Unknown (No MERGE_HEAD found)"

    # 2. Identify @ai-context file paths (delegation mode)
    local_ctx_path = parse_and_summarize_ai_context(local_msg)
    remote_ctx_path = parse_and_summarize_ai_context(remote_msg)

    # 3. Return organized data for the Orchestrator
    return {
        "local": {
            "intent": local_msg,
            "ai_context_path": local_ctx_path
        },
        "remote": {
            "intent": remote_msg,
            "ai_context_path": remote_ctx_path
        }
    }

def format_process_error(e, message):
    """
    Helper function to format subprocess.CalledProcessError into a standard JSON response.
    """
    # Try to extract the error from stderr, then from stdout, and finally fallback to str(e)
    details = e.stderr.strip() if e.stderr else ""
    if not details:
        details = e.stdout.strip() if e.stdout else str(e)
    return {
        "status": "error",
        "message": message,
        "details": details
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
            
    elif ext in ['.js', '.jsx', '.cjs', '.mjs']:
        # Check if 'node' is installed on the system
        if shutil.which("node") is None:
            return {
                "status": "warning", 
                "message": "Node.js is missing. JS verification was skipped.",
                "suggestion": "To enable JS verification on Linux (Ubuntu/Debian), run:",
                "install_command": "sudo apt update && sudo apt install nodejs npm"
            }
        
        try:
            # Run node --check
            subprocess.run(
                ["node", "--check", filepath],
                capture_output=True,
                text=True,
                check=True
            )
            return {"status": "valid", "message": "JS syntax check passed."}
        except subprocess.CalledProcessError as e:
            return format_process_error(e, "JS Syntax Error")

    # --- TYPESCRIPT ---
    elif ext in ['.ts', '.tsx']:
        # Check if 'tsc' (TypeScript compiler) is installed
        if shutil.which("tsc") is None:
            return {
                "status": "warning", 
                "message": "TypeScript compiler (tsc) is missing. TS verification was skipped.",
                "suggestion": "If you already have npm installed, install TypeScript globally by running:",
                "install_command": "sudo npm install -g typescript"
            }
        
        try:
            # Run tsc --noEmit (checks syntax and types without generating .js files)
            subprocess.run(
                ["tsc", "--noEmit", filepath],
                capture_output=True,
                text=True,
                check=True
            )
            return {"status": "valid", "message": "TS syntax check passed."}
        except subprocess.CalledProcessError as e:
            return format_process_error(e, "TS Syntax/Type Error")
            
    # For other files, currently return valid (or implement specific linters)
    return {"status": "valid", "message": f"No linter configured for {ext}, assuming valid."}

def create_backup(filepath):
    """Automatically creates a .bak copy of the file."""
    if os.path.exists(filepath):
        backup_path = f"{filepath}.bak"
        shutil.copy2(filepath, backup_path)

def restore_backup(filepath):
    """Restore the file from the .bak copy."""
    backup_path = f"{filepath}.bak"
    if os.path.exists(backup_path):
        # Overwrite the corrupted file with the backup
        shutil.copy2(backup_path, filepath) 
        return {"status": "success", "message": f"The file has been restored to its original state in {backup_path}"}
    return {"status": "error", "message": f"No backup found.({backup_path})."}

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

    # --- Command: restore ---
    restore_parser = subparsers.add_parser("restore", help="Restore the file from a .bak backup")
    restore_parser.add_argument("filepath", type=str, help="Path to the file to be restored")

    args = parser.parse_args()

    def _in_repo(fp):
        root = run_git_command("git rev-parse --show-toplevel") or ""
        return os.path.abspath(fp).startswith(root + os.sep)

    # Command routing
    if args.command == "list":
        result = list_conflicted_files()
        print(json.dumps(result, indent=2))

    elif args.command == "extract":
        filepath = args.filepath
        if not _in_repo(filepath):
            print(json.dumps({"status": "error", "message": "Path outside repository"}))
            sys.exit(1)

        #Perform the backup before extracting the data
        create_backup(filepath)
        
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
        if not _in_repo(args.filepath):
            print(json.dumps({"status": "error", "message": "Path outside repository"}))
            sys.exit(1)
        result = verify_syntax(args.filepath)
        if result.get("status") == "valid":
            bak = args.filepath + ".bak"
            if os.path.exists(bak):
                os.remove(bak)
        print(json.dumps(result, indent=2))

    elif args.command == "restore":
        if not _in_repo(args.filepath):
            print(json.dumps({"status": "error", "message": "Path outside repository"}))
            sys.exit(1)
        result = restore_backup(args.filepath)
        print(json.dumps(result, indent=2))

    else:
        # If no command is provided
        parser.print_help()

if __name__ == "__main__":
    main()