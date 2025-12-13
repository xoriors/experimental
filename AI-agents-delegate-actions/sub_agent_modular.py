import google.generativeai as genai
import json
from registry import ToolRegistry


class SubAgentLLM:
    def __init__(self, model_name="models/gemini-2.5-flash"):
        self.model_name = model_name
        self.registry = ToolRegistry()
        self.registry.load_folder("tools")

        self.categories = self.registry.get_all_categories()

        print("[SubAgent] Loaded categories:", self.categories)
        print("[SubAgent] Loaded total tools:", len(self.registry.tools))

    # ----------------------------------------------------
    # 1) Should we use tools?
    # ----------------------------------------------------
    def classify_use_tools(self, prompt):
        print("\n[SubAgent] classify_use_tools()")
        print("[SubAgent] Prompt:", prompt)

        # MCP LOGIC: use ONLY categories here
        categories_text = "\n".join(f"- {c}" for c in self.categories)

        system_msg = f"""
Ai următoarele CATEGORII de tool-uri:

{categories_text}

Analizează cererea utilizatorului și decide dacă 
cererea NECESITĂ vreun tool din ORICARE din aceste categorii.

Răspunde STRICT:
USE_TOOLS
sau
NO_TOOLS

Nu explica, nu adăuga text suplimentar.
"""

        model = genai.GenerativeModel(
            model_name=self.model_name,
            system_instruction=system_msg
        )

        response = model.generate_content(prompt)
        result = response.text.strip().upper()

        print("[SubAgent] Classifier raw output:", result)
        return "USE_TOOLS" in result

    # ----------------------------------------------------
    # 2) Detect categories (with Markdown JSON cleanup)
    # ----------------------------------------------------
    def detect_categories(self, prompt):
        print("\n[SubAgent] detect_categories()")

        categories_text = "\n".join(self.categories)

        system_msg = f"""
            Ai următoarele categorii:

            {categories_text}

            Selectează TOATE categoriile relevante pentru cererea utilizatorului.
            Returnează STRICT un JSON list.

            Exemplu:
            ["cdl.calendar", "dogedit.core"]
            """

        model = genai.GenerativeModel(
            model_name=self.model_name,
            system_instruction=system_msg
        )

        response = model.generate_content(prompt)

        raw = response.text.strip()
        print("[SubAgent] Category detection raw:", raw)

        # -----------------------------
        # Clean Gemini's ```json output
        # -----------------------------
        cleaned = raw

        # remove triple backticks
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`").strip()
            # remove optional json prefix
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].strip()

        cleaned = cleaned.replace("```", "").strip()

        print("[SubAgent] Cleaned JSON:", cleaned)

        # -----------------------------
        # JSON PARSING
        # -----------------------------
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, list):
                return parsed
            print("[SubAgent] Parsed output is not a list.")
            return []
        except Exception as e:
            print("[SubAgent] JSON parse error:", e)
            return []
        
    # ----------------------------------------------------
    # 3) Discover tools + return FULL or MINIMAL (MCP-style)
    # ----------------------------------------------------
    def discover_and_minimize(self, prompt, categories):
        print("\n[SubAgent] discover_and_minimize()")
        print("[SubAgent] Categories:", categories)

        # 1. Combine tool candidates
        candidates = []
        for c in categories:
            candidates += self.registry.get_tools_by_category(c)

        print("[SubAgent] Candidate tools:", len(candidates))

        # Build minimal tool list text (for LLM selection)
        tool_list_text = "\n".join(
            f"- {t['name']}: {t['description']}"
            for t in candidates
        )

        system_msg = f"""
Ai aceste tool-uri candidate:

{tool_list_text}

Selectează DOAR tool-urile RELEVANTE pentru acest prompt.
Returnează STRICT un JSON list cu numele tool-urilor, de forma:
["cdl.calendar.event_create"]

NU explica.
NU adăuga text suplimentar.
"""

        model = genai.GenerativeModel(
            model_name=self.model_name,
            system_instruction=system_msg
        )

        response = model.generate_content(prompt)
        raw_text = response.text.strip()

        print("\n[SubAgent] Tool discovery raw response:")
        print(raw_text)

        # -----------------------------
        # Clean Gemini Markdown JSON
        # -----------------------------
        cleaned = raw_text

        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`").strip()
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].strip()
        cleaned = cleaned.replace("```", "").strip()

        print("\n[SubAgent] Cleaned JSON for parsing:")
        print(cleaned)

        # -----------------------------
        # Parse JSON list
        # -----------------------------
        try:
            selected = json.loads(cleaned)
            if not isinstance(selected, list):
                print("[SubAgent] Parsed output is not a list. Returning empty.")
                return []
        except Exception as e:
            print("[SubAgent] JSON parsing failed:", e)
            return []

        print("[SubAgent] Selected tool names:", selected)

        # -----------------------------
        # Return FULL or MINIMAL based on count
        # -----------------------------
        if len(selected) <= 10:
            print("[SubAgent] Returning FULL schema (<= 10 tools).")
            full_defs = self.registry.get_tools_by_names(selected)
            return full_defs

        else:
            print("[SubAgent] Returning MINIMAL schema (> 10 tools).")
            minimal_defs = self.registry.get_minimal_tool_info(selected)
            return minimal_defs