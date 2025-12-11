import json
import os

class ToolRegistry:
    def __init__(self):
        self.tools = {}

    def load_folder(self, folder):
        for file in os.listdir(folder):
            if file.endswith(".json"):
                with open(os.path.join(folder, file)) as f:
                    for tool in json.load(f):
                        self.tools[tool["name"]] = tool

    def all_tools(self):
        return list(self.tools.values())

    def get_tools_by_category(self, category_name):
        return [t for t in self.tools.values() if t["name"].startswith(category_name)]

    def get_tools_by_names(self, names):
        return [self.tools[n] for n in names if n in self.tools]