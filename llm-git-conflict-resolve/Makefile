SCRIPT_RENAME = generate_conflict_rename_vs_modify.sh
DIR_RENAME    = conflict-rename-vs-modify

SCRIPT_LOGIC  = generate_conflict_logic_merge.sh
DIR_LOGIC     = conflict-logic-merge

.PHONY: all help rename logic clean

all: help

help:
	@echo "Available targets:"
	@echo "  make rename   - Generate Rename vs Modify conflicted repo"
	@echo "  make logic    - Generate Logic Merge conflicted repo"
	@echo "  make clean    - Remove generated directories"

rename:
	@rm -rf $(DIR_RENAME)
	@chmod +x $(SCRIPT_RENAME)
	@./$(SCRIPT_RENAME)

logic:
	@rm -rf $(DIR_LOGIC)
	@chmod +x $(SCRIPT_LOGIC)
	@./$(SCRIPT_LOGIC)

clean:
	@rm -rf $(DIR_RENAME) $(DIR_LOGIC)