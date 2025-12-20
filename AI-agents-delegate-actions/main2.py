from dotenv import load_dotenv
load_dotenv()

import os
import json
import google.generativeai as genai
from registry import ToolRegistry

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

MODEL_NAME = "models/gemini-2.5-flash"


# -----------------------------------------------------------
# Convert FULL JSON tool schema into SAFE plain-text context
# -----------------------------------------------------------
def convert_tool_to_plain_text(tool):
    """
    Convert a tool with nested JSON into a safe plain-text representation.
    This avoids JSON parsing failures and finish_reason=2 from Gemini.
    """

    text = f"TOOL: {tool['name']}\n"
    text += f"DESCRIPTION: {tool.get('description', '')}\n"

    # Arguments
    args = tool.get("arguments", {})
    if isinstance(args, dict):
        text += "ARGUMENTS:\n"
        for k, v in args.items():
            text += f"  - {k}: {v}\n"
    else:
        text += f"ARGUMENTS: {args}\n"

    # Returns
    returns = tool.get("returns", {})
    if isinstance(returns, dict):
        text += "RETURNS:\n"
        for k, v in returns.items():
            text += f"  - {k}: {v}\n"
    else:
        text += f"RETURNS: {returns}\n"

    # Optional usage/examples
    if "usage" in tool:
        text += f"USAGE EXAMPLE: {tool['usage']}\n"

    # Optional advanced information
    if "details" in tool:
        text += f"DETAILS: {tool['details']}\n"

    text += "-" * 40 + "\n"
    return text


def build_full_plain_context(registry: ToolRegistry):
    """Build the FULL context (bruteforce mode) using plain text only."""
    ctx = "=== SINGLE-AGENT MODE — FULL TOOLSET AS PLAIN TEXT ===\n\n"
    ctx += "Modelul primește TOATE tool-urile aici în format text simplu.\n"
    ctx += "Această variantă este intenționat ineficientă pentru comparație cu MCP.\n\n"

    # Categories
    ctx += "=== TOOL CATEGORIES ===\n"
    for cat in registry.get_all_categories():
        ctx += f"- {cat}\n"

    ctx += "\n=== ALL TOOL DEFINITIONS (PLAIN TEXT) ===\n"

    # Add each tool in plain text WITHOUT printing them in terminal
    for t in registry.tools.values():
        ctx += convert_tool_to_plain_text(t)

    ctx += """
=== INSTRUCȚIUNI ===
Ești un singur agent (fără Sub-Agent).

1. Utilizezi informațiile de mai sus ca baza completă de tool-uri.
2. Pe baza promptului userului:
    a) Identifici dacă e nevoie să folosești tool-uri.
    b) Alegi toolurile relevante (din lista completă).
    c) Explici ce tooluri ai alege.
    d) Generezi răspunsul final.
3. Nu inventa tool-uri.
4. Ai tot contextul în system_instruction — doar un singur call.
"""

    return ctx


# -----------------------------------------------------------
#   MAIN — Single Agent Plain Text Bruteforce Mode
# -----------------------------------------------------------
def main():
    print("=== SINGLE-AGENT (FULL TOOLSET PLAIN TEXT) ===")

    # Load all tools
    registry = ToolRegistry()
    registry.load_folder("tools")

    # Only show counts, not details
    print(f"[INFO] Loaded {len(registry.tools)} total tools.")
    print(f"[INFO] Loaded {len(registry.categories)} categories.")

    # Build huge plain-text context
    system_prompt = build_full_plain_context(registry)

    # User input
    user_prompt = input("\nUser: ")

    # Initialize model with huge context
    model = genai.GenerativeModel(
        model_name=MODEL_NAME,
        system_instruction=system_prompt
    )

    print("\n[INFO] Sending FULL single-agent prompt to Gemini...\n")

    # SAFE generation
    response = model.generate_content(user_prompt)
    cand = response.candidates[0]

    # Extract response safely
    if not cand.content.parts:
        print("⚠️ Model returned no text.")
        print("finish_reason =", cand.finish_reason)
        return

    result = cand.content.parts[0].text

    # 🔥 SAVE RESULT TO FILE (instead of printing)
    filename = "raspuns_model_single_agent.md"
    with open(filename, "w", encoding="utf-8") as f:
        f.write(result)

    print(f"\n=== MODEL RESPONSE SAVED TO {filename} ===")

    # Token usage
    usage = response.usage_metadata

    print("\n=== TOKEN USAGE (SINGLE AGENT FULL CONTEXT) ===")
    print("Input tokens: ", usage.prompt_token_count)
    print("Output tokens:", usage.candidates_token_count)
    print("Total tokens: ", usage.total_token_count)


if __name__ == "__main__":
    main()