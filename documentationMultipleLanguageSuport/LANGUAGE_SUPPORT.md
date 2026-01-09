# Multi-Language Syntax Validation Support

This document describes the syntax validation capabilities of the Git Merge Conflict Resolution skill across different programming languages.

## Currently Supported Languages

### Python (.py)

- **Validator:** Built-in AST parser
- **Requirements:** None (Python standard library)
- **Validation Method:** `ast.parse()`
- **Coverage:** Full syntax validation including indentation errors

### JavaScript (.js, .jsx, .mjs)

- **Validator:** Node.js
- **Requirements:** `node` must be installed
- **Validation Method:** `node --check`
- **Coverage:** ECMAScript syntax validation
- **Install:** [Download Node.js](https://nodejs.org/)

### TypeScript (.ts, .tsx)

- **Validator:** TypeScript Compiler
- **Requirements:** `tsc` must be installed globally
- **Validation Method:** `tsc --noEmit --skipLibCheck`
- **Coverage:** Full TypeScript type checking
- **Install:** `npm install -g typescript`

### JSON (.json)

- **Validator:** Built-in JSON parser
- **Requirements:** None (Python standard library)
- **Validation Method:** `json.load()`
- **Coverage:** JSON syntax and structure validation

### Go (.go)

- **Validator:** Go compiler
- **Requirements:** `go` must be installed
- **Validation Method:** `go fmt`
- **Coverage:** Go syntax validation
- **Install:** [Download Go](https://golang.org/dl/)

### Rust (.rs)

- **Validator:** Rust compiler
- **Requirements:** `rustc` must be installed
- **Validation Method:** `rustc --crate-type lib`
- **Coverage:** Full Rust syntax and borrow checker
- **Install:** [Install Rust](https://rustup.rs/)

### Generic Fallback (All Other Files)

- **Validator:** Basic file readability check
- **Requirements:** None
- **Coverage:** Checks if file exists and is readable as UTF-8 text
- **Limitation:** Does NOT validate actual syntax

---

## Validation Status Messages

The validator returns a JSON object with the following fields:

```json
{
  "status": "valid" | "error" | "warning" | "skipped",
  "message": "Human-readable status message",
  "details": "Detailed error information (if applicable)",
  "language": "python" | "javascript" | "typescript" | ...
}
```

### Status Types

| Status    | Meaning                                              |
| --------- | ---------------------------------------------------- |
| `valid`   | File syntax is correct                               |
| `error`   | Syntax error detected                                |
| `warning` | File validated but with caveats (e.g., binary files) |
| `skipped` | Required tool not installed, validation skipped      |

---

## Usage Examples

### From Command Line

```bash
# Verify a Python file
python get_tools.py verify src/main.py

# Verify a TypeScript file
python get_tools.py verify components/App.tsx

# Verify a JSON configuration
python get_tools.py verify package.json
```

### From Agent Context

The agent can call the verify command after resolving conflicts:

```
Agent: I've resolved the conflict in `server.js`. Let me verify the syntax...
System: python get_tools.py verify server.js
Output: {"status": "valid", "message": "JavaScript syntax check passed.", "language": "javascript"}
Agent: ✓ Syntax verified. You can now run `git add server.js`.
```

---

## Adding Support for New Languages

To add a new language validator:

### 1. Create a Validator Class

In `syntax_validators.py`, add a new class:

```python
class YourLanguageValidator(SyntaxValidator):
    """Validates YourLanguage syntax."""

    def __init__(self):
        super().__init__()
        self.supported_extensions = ['.ext']  # File extensions
        self.has_tool = self._check_tool_available()

    def _check_tool_available(self) -> bool:
        """Check if validation tool is installed."""
        try:
            subprocess.run(['your-tool', '--version'],
                         capture_output=True,
                         check=True,
                         timeout=2)
            return True
        except:
            return False

    def validate(self, filepath: str) -> Dict[str, str]:
        if not self.has_tool:
            return {
                "status": "skipped",
                "message": "Tool not found. Install instructions...",
                "language": "yourlanguage"
            }

        # Your validation logic here
        # ...

        return {
            "status": "valid",
            "message": "Validation passed.",
            "language": "yourlanguage"
        }
```

### 2. Register the Validator

In `ValidatorRegistry.__init__()`, add your validator:

```python
self.validators = [
    PythonValidator(),
    JavaScriptValidator(),
    # ... existing validators ...
    YourLanguageValidator(),  # Add here
]
```

### 3. Test

```bash
python syntax_validators.py path/to/file.ext
```

---

## Language Priority Suggestions

Based on GitHub usage statistics, recommended next languages to support:

1. **Java** (.java) - Use `javac` or `jdk.compiler` API
2. **C/C++** (.c, .cpp, .h) - Use `gcc -fsyntax-only`
3. **C#** (.cs) - Use `dotnet build` or Roslyn
4. **PHP** (.php) - Use `php -l`
5. **Ruby** (.rb) - Use `ruby -c`
6. **Swift** (.swift) - Use `swiftc -parse`
7. **Kotlin** (.kt) - Use `kotlinc`

---

## Graceful Degradation

The system is designed to **never block** the agent's workflow:

- If a validator is not installed → `status: "skipped"` with helpful install message
- If file type is unsupported → Generic validator checks basic readability
- If validation times out → Returns error but doesn't crash

This ensures the agent can always proceed with merge resolution, even in environments with limited tooling.

---

## Performance Considerations

### Fast Validators (< 100ms)

- Python (AST)
- JSON (Native)
- Generic (File read)

### Medium Validators (< 1s)

- JavaScript (Node.js)
- Go (go fmt)

### Slower Validators (1-5s)

- TypeScript (tsc with type checking)
- Rust (rustc compilation)

**Optimization:** All validators have a 5-10 second timeout to prevent hanging.

---

## Testing the Validator

### Create Test Files

```bash
# In your test repo
mkdir -p test_files

# Python test
echo "print('hello')" > test_files/valid.py
echo "print('unclosed" > test_files/invalid.py

# JavaScript test
echo "console.log('hello');" > test_files/valid.js
echo "console.log('unclosed" > test_files/invalid.js

# JSON test
echo '{"valid": true}' > test_files/valid.json
echo '{"invalid": }' > test_files/invalid.json
```

### Run Validation

```bash
python get_tools.py verify test_files/valid.py
python get_tools.py verify test_files/invalid.py
python get_tools.py verify test_files/valid.js
python get_tools.py verify test_files/invalid.json
```

---

## FAQ

### Q: What if I don't have Node.js installed?

**A:** JavaScript files will return `status: "skipped"` with a message explaining what's missing. The agent can still resolve the conflict, but won't validate syntax.

### Q: Can I disable validation for certain file types?

**A:** Yes. Modify the `ValidatorRegistry` to skip specific extensions, or the agent can be instructed to skip the verify step.

### Q: Does validation modify my files?

**A:** No. All validators are read-only except `go fmt`, which we run in a way that doesn't modify the original file.

### Q: What about binary files (images, PDFs)?

**A:** The generic validator detects binary files and returns `status: "warning"` without attempting text parsing.

---

## Integration with instructions.md

The agent's main instructions should reference this capability:

```markdown
### COMMAND: apply

**Action:**

1. Write the resolved content to disk
2. **Verify syntax** using `python get_tools.py verify <filepath>`
3. Report validation status to user
4. If syntax is invalid, ask user if they want Claude to fix it
```

This ensures every resolved conflict is validated before the user stages it.
