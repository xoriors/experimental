import json
import os

class ToolRegistry:
    def __init__(self):
        self.tools = {}          # name → tool schema
        self.categories = set()  # e.g. "cdl.calendar", "dogedit.core"

    def load_folder(self, folder):
        for file in os.listdir(folder):
            if file.endswith(".json"):
                with open(os.path.join(folder, file)) as f:
                    for tool in json.load(f):
                        name = tool["name"]
                        self.tools[name] = tool

                        # extract category prefix: "cdl.calendar"
                        parts = name.split(".")
                        if len(parts) >= 2:
                            cat = parts[0] + "." + parts[1]
                            self.categories.add(cat)

    def get_all_categories(self):
        """Return sorted list of unique categories."""
        return sorted(list(self.categories))

    def get_all_tool_names(self):
        """Return list of all tool names (for classification)."""
        return list(self.tools.keys())

    def get_tools_by_category(self, category_prefix):
        """Return all tools starting with that prefix."""
        return [
            tool for tool in self.tools.values()
            if tool["name"].startswith(category_prefix)
        ]

    def get_tools_by_names(self, names):
        """Return tool definitions for given names (if they exist)."""
        return [
            self.tools[name]
            for name in names
            if name in self.tools
        ]

    def get_minimal_tool_info(self, names):
        """Return minimal (name + description) for MCP-style injection."""
        result = []
        for n in names:
            if n in self.tools:
                t = self.tools[n]
                result.append({
                    "name": t["name"],
                    "description": t["description"]
                })
        return result