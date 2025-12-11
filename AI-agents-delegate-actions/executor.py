class Executor:
    def execute(self, tool, args):
        return {
            "tool": tool["name"],
            "args": args,
            "result": "success"
        }