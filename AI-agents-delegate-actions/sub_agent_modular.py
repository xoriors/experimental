import google.generativeai as genai
import os
import json


class SubAgentLLM:
    def __init__(self, model="gemini-1.5-flash-latest"):
        self.model = genai.GenerativeModel(model)

    # ----------------------------------------------------
    # 1. CLASSIFIER — decide dacă sunt necesare tool-uri
    # ----------------------------------------------------
    def classify_use_tools(self, user_prompt):
        system_msg = """
Analizează cererea utilizatorului și decide dacă necesită folosirea unor tool-uri.
Returnează STRICT:
USE_TOOLS
sau
NO_TOOLS
"""

        response = self.model.generate_content(
            [
                {"role": "system", "parts": [{"text": system_msg}]},
                {"role": "user", "parts": [{"text": user_prompt}]}
            ]
        )

        output = response.text.strip().upper()
        return "USE_TOOLS" in output

    # ----------------------------------------------------
    # 2. CATEGORY DETECTION — MULTIPLE categories
    # ----------------------------------------------------
    def detect_categories(self, user_prompt, available_categories):
        categories_text = "\n".join(available_categories)

        system_msg = f"""
Ai următoarele seturi de tool-uri (categorii):
{categories_text}

Pe baza cererii utilizatorului, identifică TOATE categoriile relevante.
Returnează STRICT un JSON list, ex:
["cdl.calendar", "dogedit.core"]
"""

        response = self.model.generate_content(
            [
                {"role": "system", "parts": [{"text": system_msg}]},
                {"role": "user", "parts": [{"text": user_prompt}]}
            ]
        )

        try:
            return json.loads(response.text)
        except:
            return []

    # ----------------------------------------------------
    # 3. TOOL DISCOVERY — selectare tool-uri relevante
    # ----------------------------------------------------
    def discover_tools(self, user_prompt, tools_from_categories):
        tool_list_text = ""
        for t in tools_from_categories:
            tool_list_text += f"- {t['name']}: {t['description']}\n"

        system_msg = f"""
Ai acces la următoarea listă completă de tool-uri:

{tool_list_text}

Selectează DOAR tool-urile RELEVANTE pentru cererea utilizatorului.
Returnează STRICT un JSON list cu nume tool-uri.
"""

        response = self.model.generate_content(
            [
                {"role": "system", "parts": [{"text": system_msg}]},
                {"role": "user", "parts": [{"text": user_prompt}]}
            ]
        )

        try:
            return json.loads(response.text)
        except:
            return []