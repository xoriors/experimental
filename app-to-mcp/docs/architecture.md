# app-to-mcp architecture

## Components

```mermaid
flowchart TB
    subgraph Host["MCP host (Claude, Cursor, Codex…)"]
        M[Model]
        CK["Cockpit iframe<br/>ui://app-to-mcp/cockpit"]
    end

    subgraph Runtime["app-to-mcp runtime (Rust, rmcp)"]
        TR[Tool router]
        SP[(Spec store<br/>versioned YAML)]
        AU[Auth manager]
        PG[Policy gate<br/>tiers + approvals]
        AL[(Audit log)]
        HE[Healer]
    end

    subgraph Drivers
        WD[Web driver<br/>chromiumoxide / CDP]
        DD[Desktop driver<br/>AX · UIA · AT-SPI]
        VD[Vision fallback]
    end

    KC[(OS keychain)]
    APP[(Target app<br/>HTTP API / UI)]

    M -- tools/call --> TR
    CK -- tools/call via host bridge --> TR
    TR --> PG --> AL
    TR --> SP
    TR --> AU --> KC
    TR -- HTTP --> APP
    HE --> WD & DD & VD --> APP
    TR -- on failure --> HE -- patch proposal --> CK
```

## Record → compile

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant CK as Cockpit (MCP App)
    participant RC as Recorder
    participant BR as Chromium (dedicated profile)
    participant CP as Compiler
    participant LLM as Model

    U->>CK: Start recording "create invoice"
    CK->>RC: tools/call record.start(app, task)
    RC->>BR: launch --user-data-dir, enable Network + Page.startScreencast
    BR-->>CK: screencast frames (live view)
    U->>BR: does the task once (logs in if needed)
    BR-->>RC: requests, responses, DOM events
    U->>CK: Stop
    RC->>CP: trace.json (redacted)
    CP->>CP: cluster endpoints, infer JSON Schema, detect auth/CSRF
    CP->>LLM: name + describe + classify risk (redacted samples only)
    LLM-->>CP: tool candidates
    CP-->>CK: draft spec for review
    U->>CK: rename / drop / mark destructive, approve
    CK->>CP: spec v1 committed
```

## Runtime call and self-healing

```mermaid
sequenceDiagram
    autonumber
    participant M as Model
    participant RT as Runtime
    participant PG as Policy gate
    participant APP as Target app
    participant HE as Healer
    participant CK as Cockpit

    M->>RT: invoices.create {customer, amount}
    RT->>PG: risk = write
    PG-->>RT: allowed (tier: write)
    RT->>APP: POST /api/v2/invoices
    alt 2xx and response matches schema
        APP-->>RT: 201 {...}
        RT-->>M: structured result
    else 404 / schema mismatch
        APP-->>RT: error
        RT->>HE: heal(tool, inputs)
        HE->>APP: drive UI via recorded path, capture traffic
        HE-->>RT: result + new endpoint
        RT-->>M: result (marked "healed")
        HE->>CK: patch proposal (diff spec v1 → v2)
        CK-->>HE: user approves → spec v2
    end
```

## Spec lifecycle

```mermaid
stateDiagram-v2
    [*] --> Draft: compile
    Draft --> Reviewed: user edits in cockpit
    Reviewed --> Active: approve
    Active --> Degraded: replay test or call fails
    Degraded --> Active: heal patch approved
    Degraded --> Draft: re-record
    Active --> Published: share to registry (later)
```

## Risk tiers

| Tier | Example | Default policy |
| --- | --- | --- |
| `read` | list invoices | auto |
| `write` | create a draft | auto, logged |
| `destructive` | delete, send, pay | approval card in the cockpit, every call |
| `blocked` | banking, password managers | never exposed |
