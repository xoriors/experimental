from dotenv import load_dotenv
load_dotenv()

import os
import google.generativeai as genai

from registry import ToolRegistry
from sub_agent_modular import SubAgentLLM

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

MODEL_NAME = "gemini-1.5-flash-latest"


def gemini_answer_with_tools(prompt, tool_defs):

    tool_ctx = ""
    for t in tool_defs:
        tool_ctx += f"Tool: {t['name']}\n"
        tool_ctx += f"  Description: {t['description']}\n"
        tool_ctx += f"  Arguments: {t['arguments']}\n"
        tool_ctx += f"  Returns: {t['returns']}\n\n"

    system_msg = f"""
Ești agentul principal.
Ai acces DOAR la următoarele tool-uri:

{tool_ctx}

Răspunde folosind DOAR aceste tool-uri.
"""

    model = genai.GenerativeModel(MODEL_NAME)

    response = model.generate_content(
        [
            {"role": "system", "parts": [{"text": system_msg}]},
            {"role": "user", "parts": [{"text": prompt}]}
        ]
    )

    return response.text


def main():
    registry = ToolRegistry()
    registry.load_folder("tools")

    sub = SubAgentLLM()

    user_prompt = input("User: ")

    print("=== Step 1: CLASSIFY USE_TOOLS ===")
    if not sub.classify_use_tools(user_prompt):
        print("\nGemini normal:")
        model = genai.GenerativeModel(MODEL_NAME)
        print(model.generate_content(user_prompt).text)
        return

    available_categories = ["cdl.calendar", "dogedit.core"]

    print("\n=== Step 2: DETECT CATEGORIES ===")
    categories = sub.detect_categories(user_prompt, available_categories)
    print("Detected categories:", categories)

    if not categories:
        print("No categories detected.")
        return

    # collect tools relevant to categories
    combined_tools = []
    for cat in categories:
        combined_tools += registry.get_tools_by_category(cat)

    print("\n=== Step 3: DISCOVER SPECIFIC TOOLS ===")
    tool_names = sub.discover_tools(user_prompt, combined_tools)
    print("Tool names:", tool_names)

    if not tool_names:
        print("No tools selected.")
        return

    tool_defs = registry.get_tools_by_names(tool_names)

    print("\n=== Step 4: FINAL ANSWER FROM GEMINI ===")
    answer = gemini_answer_with_tools(user_prompt, tool_defs)
    print("\nFinal answer:\n", answer)


if __name__ == "__main__":
    main()