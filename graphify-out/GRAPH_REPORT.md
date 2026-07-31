# Graph Report - .  (2026-07-31)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 388 nodes · 780 edges · 19 communities (17 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `78fd45e1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_UI Components|UI Components]]
- [[_COMMUNITY_Clipboard & Scanning|Clipboard & Scanning]]
- [[_COMMUNITY_Session Management|Session Management]]
- [[_COMMUNITY_Dependencies & Build|Dependencies & Build]]
- [[_COMMUNITY_Pty & Process Control|Pty & Process Control]]
- [[_COMMUNITY_Activity & Settings|Activity & Settings]]
- [[_COMMUNITY_Templates & Routing|Templates & Routing]]
- [[_COMMUNITY_Brain & Storage|Brain & Storage]]
- [[_COMMUNITY_Git & Model Detection|Git & Model Detection]]
- [[_COMMUNITY_Agent & Session Discovery|Agent & Session Discovery]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Resource Monitoring|Resource Monitoring]]
- [[_COMMUNITY_Menu Navigation|Menu Navigation]]
- [[_COMMUNITY_Workspace Concepts|Workspace Concepts]]
- [[_COMMUNITY_App & Tools|App & Tools]]
- [[_COMMUNITY_App Entry|App Entry]]

## God Nodes (most connected - your core abstractions)
1. `SessionStore` - 40 edges
2. `PtyManager` - 36 edges
3. `TerminalSession` - 27 edges
4. `ActivityTracker` - 18 edges
5. `WorkspaceBrainStore` - 18 edges
6. `AgentKind` - 16 edges
7. `AppSettings` - 15 edges
8. `useClickOutside()` - 11 edges
9. `compilerOptions` - 11 edges
10. `scanClaude()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Props` --references--> `TerminalSession`  [EXTRACTED]
  src/renderer/src/components/BrainPanel.tsx → src/shared/types.ts
- `TrackerDeps` --references--> `ActivityEvent`  [EXTRACTED]
  src/main/activity.ts → src/shared/types.ts
- `TrackerDeps` --references--> `AgentKind`  [EXTRACTED]
  src/main/activity.ts → src/shared/types.ts
- `registerIpc()` --calls--> `checkGraphifyInstalled()`  [EXTRACTED]
  src/main/index.ts → src/main/agentSessions.ts
- `handleColdSpawnEligible()` --calls--> `scanSessions()`  [EXTRACTED]
  src/main/index.ts → src/main/agentSessions.ts

## Import Cycles
- None detected.

## Communities (19 total, 2 thin omitted)

### Community 0 - "UI Components"
Cohesion: 0.08
Nodes (43): ActivityCenter(), Props, BrainPanel(), Props, BroadcastPanel(), FleetMenu(), Props, AGENTS (+35 more)

### Community 1 - "Clipboard & Scanning"
Cohesion: 0.06
Nodes (34): getInstalled(), scanOpenCode(), scanSessions(), analyzeClipboard(), cleanupPastes(), copyText(), pastesDir(), AGENT_LABELS (+26 more)

### Community 2 - "Session Management"
Cohesion: 0.11
Nodes (7): Props, SessionFileV2, SessionStore, WorkspaceData, FleetTemplateTerminal, OwnedAgentSession, TerminalSession

### Community 3 - "Dependencies & Build"
Cohesion: 0.05
Nodes (37): author, dependencies, @lydell/node-pty, react, react-dom, react-grid-layout, @xterm/addon-fit, @xterm/addon-search (+29 more)

### Community 5 - "Activity & Settings"
Cohesion: 0.12
Nodes (8): ActivityTracker, TermActivity, TrackerDeps, DEFAULTS, SettingsStore, ActivityInfo, ActivityState, AppSettings

### Community 6 - "Templates & Routing"
Cohesion: 0.12
Nodes (12): TemplateStore, api, onCwdRouted, onGitRouted, onModelRouted, onOfferRouted, onTermDataRouted, onTermExitRouted (+4 more)

### Community 7 - "Brain & Storage"
Cohesion: 0.21
Nodes (6): BrainSeedTerminal, linkBlock(), slugify(), template(), WorkspaceBrainStore, WorkspaceBrain

### Community 8 - "Git & Model Detection"
Cohesion: 0.16
Nodes (13): branchFor(), cache, CacheEntry, findGitEntry(), readHead(), Candidate, capitalize(), claudeLabel() (+5 more)

### Community 9 - "Agent & Session Discovery"
Cohesion: 0.26
Nodes (16): checkGraphifyInstalled(), checkOne(), claudeUserText(), hasAnyHistoryHint(), idFromFile(), listJsonlFiles(), normalizeCwd(), parseLines() (+8 more)

### Community 10 - "TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, jsx, module, moduleResolution, noEmit, resolveJsonModule, skipLibCheck (+4 more)

### Community 11 - "Resource Monitoring"
Cohesion: 0.24
Nodes (6): agentFromString(), HOST_PROCS, MONITOR_SCRIPT, ProcSample, psExe(), ResourceMonitor

### Community 12 - "Menu Navigation"
Cohesion: 0.32
Nodes (10): buildOptionRanks(), computeArrowDelta(), isRowHighlighted(), isSeparatorLine(), RankedRow, resolveKeyBytes(), scanHighlightedRows(), SyntheticKey (+2 more)

### Community 13 - "Workspace Concepts"
Cohesion: 0.22
Nodes (9): Atajos de teclado, Broadcast, Cerebro del workspace, Cola de prompts, Dónde vive cada cosa en disco, Plantillas de flota, Portapapeles, Terminales (+1 more)

### Community 14 - "App & Tools"
Cohesion: 0.29
Nodes (7): Ajustes, Bandeja del sistema, Claude Code, Graphify, OpenCode, Primer arranque, Qwen Code

## Knowledge Gaps
- **99 isolated node(s):** `name`, `version`, `description`, `main`, `author` (+94 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PtyManager` connect `Pty & Process Control` to `Git & Model Detection`, `Clipboard & Scanning`, `Activity & Settings`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Why does `SessionStore` connect `Session Management` to `Git & Model Detection`, `Clipboard & Scanning`, `Activity & Settings`, `UI Components`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Why does `TerminalSession` connect `Session Management` to `UI Components`, `Git & Model Detection`, `Pty & Process Control`, `Templates & Routing`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _99 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.07814207650273224 - nodes in this community are weakly interconnected._
- **Should `Clipboard & Scanning` be split into smaller, more focused modules?**
  _Cohesion score 0.061170212765957445 - nodes in this community are weakly interconnected._
- **Should `Session Management` be split into smaller, more focused modules?**
  _Cohesion score 0.10741971207087486 - nodes in this community are weakly interconnected._