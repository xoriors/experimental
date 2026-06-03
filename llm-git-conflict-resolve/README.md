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

## To implement later: capture and reuse the agent's reasoning context

This expands on the idea above into a concrete two-part flow.

### At commit time (the responsibility of whoever commits)

On each commit, collect the agent's context for the current conversation and store it in the repo so the raw reasoning travels with the history:

- The context lives on disk in the `.claude` folder. The agent knows exactly where the current conversation's context file is — if you ask it to copy that file, it should be able to.
- Save it into a file inside the repo, e.g. `/ai-context/<issue-id>-<date-time>.txt`.
- In the commit message, add a reference to the relative path of that file, e.g. `@ai-context <path>`.

This lets us know what reasoning was used when working on that commit. We keep the full raw context — much more than what fits in a commit message — which is useful both for resolving conflicts and for later bug investigation.

### At merge time (inside the merge skill)

When the skill analyzes a commit message and finds an `@ai-context <path>` reference:

- Delegate a sub-agent to produce a summary of that context file.
- Do this for **both** commits involved in the conflict (local/HEAD and remote/MERGE_HEAD).
- Do **not** load the whole files into context — with two context files this could easily exceed the current context window. Only the summaries are pulled back in.
- Then instruct the merge agent to also take those summaries into account when resolving the conflict.

### Evaluation

Compare the quality of the resolution against the baseline case where no context files are provided, to measure whether the captured reasoning actually helps.
