# 🛡️ Gemini CLI Security Skills: Malware & Binary Analysis

This repository contains two powerful, locally-run AI security analysts built for the official [Gemini CLI](https://github.com/google/gemini-cli). By combining Python-based static analysis pipelines with Gemini 1.5 Pro's massive context window, you can audit full repositories for supply-chain attacks and reverse-engineer compiled binaries directly from your terminal.

## 🧠 Available Skills

1. **Malware Detection (Repo Scanner)**
   - **Target:** Source code, configurations, `.md` files.
   - **Focus:** Hunts for prompt injections, hardcoded secrets, obfuscated payloads, and data exfiltration (call-homes) across the entire project repository.
2. **Static Binary Analysis**
   - **Target:** Compiled binaries (`.elf`, `.exe`, `.dylib`).
   - **Focus:** Correlates outputs from standard reverse-engineering tools (`binwalk`, `checksec`, `objdump`, etc.) to detect memory corruption risks, ROP gadgets, and packed malware payloads.

---

## ⚙️ Prerequisites

This toolset relies on both Node.js (for the Gemini CLI) and a robust Python/Linux environment (Kali Linux recommended) for the static analysis tools.

- **Node.js:** v18 or higher.
- **Python:** 3.10+
- **Gemini API Key:** Get one from [Google AI Studio](https://aistudio.google.com/).
- **System Tools (For Binary Analysis):**
  ```bash
  sudo apt-get update
  sudo apt-get install binwalk elfutils bsdmainutils ssdeep patchelf checksec
  pip install astroid bandit ROPgadget
  ```

## 🚀 Installation & Setup
1. Install the Gemini CLI
Install the official Gemini CLI globally via npm:

```bash 
npm install -g @google/gemini-cli@latest
```

Authenticate the CLI (this will open a browser window or ask for your API key):

```bash 
gemini login
```


2. Install the Skills
Clone this repository and copy the skills directory into your local Gemini configuration folder so the CLI can discover them.

```bash
git clone [https://github.com/razvangabriel16/experimental.git](https://github.com/razvangabriel16/experimental.git)
cd experimental/malware-detection-with-llm

mkdir -p ~/.gemini/skills/

cp -r skills/malware-detection ~/.gemini/skills/
cp -r skills/binary-analysis ~/.gemini/skills/
```

3. Verify Installation
Launch the Gemini CLI and verify that the skills loaded successfully:

```bash
gemini
> /skills list all
```

## 🛠️ Usage Guide
# 🧑‍💻 Using the Repo Scanner (Source Code)
Navigate to the repository you want to audit and launch the CLI with the malware detection skill loaded.

```bash
cd /path/to/suspicious/repo
gemini
#inside the gemini cli type:
/skills use malware-detection
```

## ⚠️ Disclaimer
This tool is for educational and defensive cybersecurity purposes. Do not run suspicious binaries outside of an isolated sandbox or virtual machine. While the LLM provides powerful correlation, always manually verify critical findings.




