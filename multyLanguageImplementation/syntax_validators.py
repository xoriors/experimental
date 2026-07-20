"""
Multi-language syntax validation module for git merge conflict resolution.
This module provides syntax checking for various programming languages without
requiring external dependencies beyond standard library where possible.
"""

import os
import ast
import json
import subprocess
import tempfile
from typing import Dict, Optional


class SyntaxValidator:
    """Base class for language-specific syntax validators."""
    
    def __init__(self):
        self.supported_extensions = []
        
    def validate(self, filepath: str) -> Dict[str, str]:
        """
        Validates syntax of a file.
        
        Returns:
            Dict with keys: 'status' ('valid' or 'error'), 'message', 'details' (optional)
        """
        raise NotImplementedError("Subclasses must implement validate()")


class PythonValidator(SyntaxValidator):
    """Validates Python syntax using AST."""
    
    def __init__(self):
        super().__init__()
        self.supported_extensions = ['.py']
    
    def validate(self, filepath: str) -> Dict[str, str]:
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                source = f.read()
            ast.parse(source)
            return {
                "status": "valid",
                "message": "Python syntax check passed.",
                "language": "python"
            }
        except SyntaxError as e:
            return {
                "status": "error",
                "message": f"Syntax Error on line {e.lineno}: {e.msg}",
                "details": str(e),
                "language": "python"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Unexpected error: {str(e)}",
                "language": "python"
            }


class JavaScriptValidator(SyntaxValidator):
    """Validates JavaScript/TypeScript syntax using Node.js."""
    
    def __init__(self):
        super().__init__()
        self.supported_extensions = ['.js', '.jsx', '.mjs']
        self.has_node = self._check_node_available()
    
    def _check_node_available(self) -> bool:
        """Check if Node.js is installed."""
        try:
            subprocess.run(['node', '--version'], 
                         capture_output=True, 
                         check=True, 
                         timeout=2)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            return False
    
    def validate(self, filepath: str) -> Dict[str, str]:
        if not self.has_node:
            return {
                "status": "skipped",
                "message": "Node.js not found. Install Node.js for JavaScript validation.",
                "language": "javascript"
            }
        
        try:
            # Use node --check for syntax validation
            result = subprocess.run(
                ['node', '--check', filepath],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0:
                return {
                    "status": "valid",
                    "message": "JavaScript syntax check passed.",
                    "language": "javascript"
                }
            else:
                return {
                    "status": "error",
                    "message": "JavaScript syntax error detected.",
                    "details": result.stderr,
                    "language": "javascript"
                }
        except subprocess.TimeoutExpired:
            return {
                "status": "error",
                "message": "Syntax check timed out.",
                "language": "javascript"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Validation failed: {str(e)}",
                "language": "javascript"
            }


class TypeScriptValidator(SyntaxValidator):
    """Validates TypeScript syntax using tsc."""
    
    def __init__(self):
        super().__init__()
        self.supported_extensions = ['.ts', '.tsx']
        self.has_tsc = self._check_tsc_available()
    
    def _check_tsc_available(self) -> bool:
        """Check if TypeScript compiler is installed."""
        try:
            subprocess.run(['tsc', '--version'], 
                         capture_output=True, 
                         check=True,
                         timeout=2)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            return False
    
    def validate(self, filepath: str) -> Dict[str, str]:
        if not self.has_tsc:
            return {
                "status": "skipped",
                "message": "TypeScript compiler (tsc) not found. Install with: npm install -g typescript",
                "language": "typescript"
            }
        
        try:
            # Use tsc --noEmit for syntax check without generating output
            result = subprocess.run(
                ['tsc', '--noEmit', '--skipLibCheck', filepath],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                return {
                    "status": "valid",
                    "message": "TypeScript syntax check passed.",
                    "language": "typescript"
                }
            else:
                return {
                    "status": "error",
                    "message": "TypeScript syntax error detected.",
                    "details": result.stderr,
                    "language": "typescript"
                }
        except subprocess.TimeoutExpired:
            return {
                "status": "error",
                "message": "Syntax check timed out.",
                "language": "typescript"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Validation failed: {str(e)}",
                "language": "typescript"
            }


class JSONValidator(SyntaxValidator):
    """Validates JSON syntax."""
    
    def __init__(self):
        super().__init__()
        self.supported_extensions = ['.json']
    
    def validate(self, filepath: str) -> Dict[str, str]:
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                json.load(f)
            return {
                "status": "valid",
                "message": "JSON syntax check passed.",
                "language": "json"
            }
        except json.JSONDecodeError as e:
            return {
                "status": "error",
                "message": f"JSON Error on line {e.lineno}, column {e.colno}: {e.msg}",
                "details": str(e),
                "language": "json"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Unexpected error: {str(e)}",
                "language": "json"
            }


class GoValidator(SyntaxValidator):
    """Validates Go syntax using go fmt."""
    
    def __init__(self):
        super().__init__()
        self.supported_extensions = ['.go']
        self.has_go = self._check_go_available()
    
    def _check_go_available(self) -> bool:
        """Check if Go is installed."""
        try:
            subprocess.run(['go', 'version'], 
                         capture_output=True, 
                         check=True,
                         timeout=2)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            return False
    
    def validate(self, filepath: str) -> Dict[str, str]:
        if not self.has_go:
            return {
                "status": "skipped",
                "message": "Go compiler not found. Install Go for validation.",
                "language": "go"
            }
        
        try:
            # Use go fmt to check syntax
            result = subprocess.run(
                ['go', 'fmt', filepath],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            # go fmt returns non-zero on syntax errors
            if "syntax error" in result.stderr.lower():
                return {
                    "status": "error",
                    "message": "Go syntax error detected.",
                    "details": result.stderr,
                    "language": "go"
                }
            
            return {
                "status": "valid",
                "message": "Go syntax check passed.",
                "language": "go"
            }
        except subprocess.TimeoutExpired:
            return {
                "status": "error",
                "message": "Syntax check timed out.",
                "language": "go"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Validation failed: {str(e)}",
                "language": "go"
            }


class RustValidator(SyntaxValidator):
    """Validates Rust syntax using rustc."""
    
    def __init__(self):
        super().__init__()
        self.supported_extensions = ['.rs']
        self.has_rustc = self._check_rustc_available()
    
    def _check_rustc_available(self) -> bool:
        """Check if Rust compiler is installed."""
        try:
            subprocess.run(['rustc', '--version'], 
                         capture_output=True, 
                         check=True,
                         timeout=2)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            return False
    
    def validate(self, filepath: str) -> Dict[str, str]:
        if not self.has_rustc:
            return {
                "status": "skipped",
                "message": "Rust compiler (rustc) not found. Install Rust for validation.",
                "language": "rust"
            }
        
        try:
            # Use rustc with --crate-type lib and output to temp dir
            with tempfile.TemporaryDirectory() as tmpdir:
                result = subprocess.run(
                    ['rustc', '--crate-type', 'lib', '--out-dir', tmpdir, filepath],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                if result.returncode == 0:
                    return {
                        "status": "valid",
                        "message": "Rust syntax check passed.",
                        "language": "rust"
                    }
                else:
                    return {
                        "status": "error",
                        "message": "Rust syntax error detected.",
                        "details": result.stderr,
                        "language": "rust"
                    }
        except subprocess.TimeoutExpired:
            return {
                "status": "error",
                "message": "Syntax check timed out.",
                "language": "rust"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Validation failed: {str(e)}",
                "language": "rust"
            }


class GenericValidator(SyntaxValidator):
    """Fallback validator for unsupported file types."""
    
    def __init__(self):
        super().__init__()
        self.supported_extensions = []  # Matches any extension
    
    def validate(self, filepath: str) -> Dict[str, str]:
        _, ext = os.path.splitext(filepath)
        
        # Check if file exists and is readable
        if not os.path.exists(filepath):
            return {
                "status": "error",
                "message": "File not found",
                "language": "unknown"
            }
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                f.read()
            return {
                "status": "valid",
                "message": f"No linter configured for {ext}. Basic readability check passed.",
                "language": "unknown"
            }
        except UnicodeDecodeError:
            return {
                "status": "warning",
                "message": f"File appears to be binary ({ext}). Skipping syntax check.",
                "language": "binary"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"File read error: {str(e)}",
                "language": "unknown"
            }


class ValidatorRegistry:
    """Registry that maps file extensions to appropriate validators."""
    
    def __init__(self):
        self.validators = [
            PythonValidator(),
            JavaScriptValidator(),
            TypeScriptValidator(),
            JSONValidator(),
            GoValidator(),
            RustValidator(),
        ]
        self.generic_validator = GenericValidator()
        
        # Build extension map
        self.extension_map = {}
        for validator in self.validators:
            for ext in validator.supported_extensions:
                self.extension_map[ext] = validator
    
    def get_validator(self, filepath: str) -> SyntaxValidator:
        """Returns the appropriate validator for a given file."""
        _, ext = os.path.splitext(filepath)
        return self.extension_map.get(ext, self.generic_validator)
    
    def validate_file(self, filepath: str) -> Dict[str, str]:
        """Validates a file using the appropriate validator."""
        validator = self.get_validator(filepath)
        return validator.validate(filepath)
    
    def list_supported_languages(self) -> list:
        """Returns list of supported languages with their extensions."""
        languages = []
        for validator in self.validators:
            if validator.supported_extensions:
                lang = validator.validate("")  # Get language name
                languages.append({
                    "language": lang.get("language", "unknown"),
                    "extensions": validator.supported_extensions
                })
        return languages


# Singleton instance
_registry = ValidatorRegistry()


def verify_syntax(filepath: str) -> Dict[str, str]:
    """
    Main entry point for syntax verification.
    This function should be called from get_tools.py
    
    Args:
        filepath: Path to the file to verify
        
    Returns:
        Dictionary with validation results
    """
    return _registry.validate_file(filepath)


def list_supported_languages() -> list:
    """Returns list of all supported languages."""
    return _registry.list_supported_languages()


if __name__ == "__main__":
    # CLI for testing
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python syntax_validators.py <filepath>")
        print("\nSupported languages:")
        for lang_info in list_supported_languages():
            print(f"  {lang_info['language']}: {', '.join(lang_info['extensions'])}")
        sys.exit(1)
    
    filepath = sys.argv[1]
    result = verify_syntax(filepath)
    print(json.dumps(result, indent=2))