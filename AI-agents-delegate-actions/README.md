# MCP proxy or delegate to sub-agents to reduce the main context of AI agents

A big problem with using MCP servers in AI agents, especially, is that the context window increases like crazy, even when you want to make a simple tool call; all tools are loaded.  

## Ideas

what I think can be done nicely is a kind of RAG for MCP tools :)
- you have an agent that responds with what tools from MCP make sense for your prompt
- in the main context only those tools are added, not all from the MCP server
- the main agent then calls only those tools
- this reduces what is loaded in the context but still brings definition to those tools

Or so that you don't bring those either or you can make a kind of MPC proxy
- you have a sub-agent that responds with what tool names from MCP make sense for your prompt
- in the main context only those tool names are added, without definition
- the main agent then invokes and that sub-agent calls tools by name for what data it wants
- and the data mapping to the MCP payload and the actual call to the tools is done in the sub-agent context which is temp
- in the main context only pure result gets back
- the advantage: bring only tools names + output values ​​from the MCP server to the main context

Those sub-agents can use skills that exist only in their context when invoked and do not enter the main context.

## Possible solution

One solution could be to delegate some actions to sub-agents for execution outside the main context window, or to have an MCP server handle them and use another LLM or agent with a different context window internally.

1. Tool discovery sub-agent returns:
   - Tool names + minimal descriptions (5-10 tokens each)
   - NOT full schemas
2. Main context gets lightweight tool list
3. When main agent wants to call a tool:
   - Passes intent to sub-agent
   - Sub-agent sees full schemas, executes MCP call
   - Returns just the result

## Existing solutions

Claude created something similar https://www.anthropic.com/engineering/advanced-tool-use with these

> Today, we're releasing three features that make this possible:
> - Tool Search Tool, which allows Claude to use search tools to access thousands of tools without consuming its context window
> - Programmatic Tool Calling, which allows Claude to invoke tools in a code execution environment reducing the impact on the model’s context window
> - Tool Use Examples, which provides a universal standard for demonstrating how to effectively use a given tool

## Still existing motivation

Of course, they have access to the agent code and are able to change also specs for MCP, implemented this very nicely.  
But we could create a solution that is agent-agnostic, which can then be used with any agents that support concepts like sub-agents, MCP, and others.

## Ref

https://www.claude.com/blog/skills
