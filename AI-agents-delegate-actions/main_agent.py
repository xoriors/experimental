from dotenv import load_dotenv
load_dotenv()

import json
import os
import google.generativeai as genai

from sub_agent_modular import SubAgentLLM

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

MODEL_NAME = "models/gemini-2.5-flash"


def gemini_answer_with_tools(prompt, selected_tools):
    print("\n[MainAgent] Injecting tool context...")

    FULL_LIMIT = 10

    if len(selected_tools) <= FULL_LIMIT:
        print("[MainAgent] Injecting FULL tool schema (<= 10 tools).")
        tool_ctx = ""
        for t in selected_tools:
            tool_ctx += f"TOOL: {t['name']}\n"
            tool_ctx += f"DESCRIPTION: {t.get('description','')}\n"
            tool_ctx += f"ARGUMENTS: {json.dumps(t.get('arguments',{}), indent=2)}\n"
            tool_ctx += f"RETURNS: {json.dumps(t.get('returns',{}), indent=2)}\n"
            tool_ctx += f"USAGE: {t.get('usage','No example')}\n"
            tool_ctx += f"DETAILS: {t.get('details','No details')}\n"
            tool_ctx += "-----------------------------------------\n"
    else:
        print("[MainAgent] Too many tools (> 10). Injecting REDUCED schema.")
        tool_ctx = ""
        for t in selected_tools:
            tool_ctx += f"- {t['name']}: {t['description']}\n"

    system_msg = f"""
Ești agentul principal.

Ai acces la următoarele tool-uri relevante:
{tool_ctx}

Instrucțiuni:
- Dacă schema este completă, folosește argumentele corecte.
- Dacă schema este redusă, deduci intenția și explici tool-ul.
- Nu inventa tool-uri noi.
- Răspunde pe baza tool-urilor date.
"""

    model = genai.GenerativeModel(
        model_name=MODEL_NAME,
        system_instruction=system_msg
    )

    response = model.generate_content(prompt)

    # 🔥 returnăm și response.usage_metadata
    return response.text, response.usage_metadata



def main():
    print("=== AI Delegate Action System ===")

    user_prompt = input("\nUser: ")
    print("\n[MainAgent] Passing prompt to Sub-Agent for classification...")

    sub = SubAgentLLM(model_name=MODEL_NAME)
    
    use_tools = sub.classify_use_tools(user_prompt)
    print(f"[SubAgent] USE_TOOLS = {use_tools}")

    if not use_tools:
        print("\n[MainAgent] No tools needed. Gemini answering normally...\n")
        model = genai.GenerativeModel(MODEL_NAME)
        resp = model.generate_content(user_prompt)

        usage = resp.usage_metadata
        print("\n=== MAIN AGENT TOKEN USAGE ===")
        print(f"Input tokens (system + user):  {usage.prompt_token_count}")
        print(f"Output tokens:                {usage.candidates_token_count}")
        print(f"Total tokens:                 {usage.total_token_count}")

        print("\n=== FINAL ANSWER ===\n")
        print(resp.text)
        return

    print("\n[MainAgent] Asking Sub-Agent for category detection...")
    categories = sub.detect_categories(user_prompt)
    print("[SubAgent] Categories:", categories)

    if not categories:
        print("[MainAgent] No categories found.")
        return

    print("\n[MainAgent] Asking Sub-Agent for specific tool selection...")
    minimal_defs = sub.discover_and_minimize(user_prompt, categories)

    if not minimal_defs:
        print("[MainAgent] No tools selected.")
        return

    print("\n[MainAgent] Sending final minimal tool context to Gemini...\n")
    result_text, usage = gemini_answer_with_tools(user_prompt, minimal_defs)

   
    print("\n=== FINAL ANSWER SAVED TO FILE ===")

# scrie răspunsul în fișier
    with open("raspuns_model_mcp.md", "w", encoding="utf-8") as f:
        f.write(result_text)

    print("File created: raspuns_model_mcp.md")
    print("\n=== MAIN AGENT TOKEN USAGE ===")
    print(f"Input tokens (system + user):  {usage.prompt_token_count}")
    print(f"Output tokens:                {usage.candidates_token_count}")
    print(f"Total tokens:                 {usage.total_token_count}")



if __name__ == "__main__":
    main()