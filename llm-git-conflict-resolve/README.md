# LLM Git conflict resolve

A growing issue with these AI coding agents is that we end up with more code we don't fully understand, and when we work in a team, it's inevitable to make changes to the same file and run into git merge conflicts.  
And given that the conflicted code was most likely not written by us, resolving such merge conflicts could be complicated and unpleasant work for a dev.

So we are experimenting with how AI agents could help mitigate this. After all, they will be the ones writing that code :)

One idea is to use Claude Code skills to instruct the agent on how it could help, like
- instructions on steps that would help, something similar to https://subagents.cc/
- analyze previous commits to see how the code evolved
- include in the skill any code that might help to be executed while investigating
- ... open to suggestions

Additionally, maybe it would help to save the AI coding agent's context window when it generates code for a feat to the PR or commits, so that when it analyzes commits to resolve the conflict, it can have the reasoning for why the code was generated that way. This info could also help with bug investigation.
