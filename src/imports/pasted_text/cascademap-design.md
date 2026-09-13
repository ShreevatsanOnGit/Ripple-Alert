Design and prototype a polished production quality web application called CascadeMap.

CascadeMap is a disaster resilience and critical infrastructure simulation platform. It shows how the failure of one road or infrastructure asset can disrupt other parts of a city network and affect people, hospitals, depots, and connected infrastructure.

This is a hackathon project called:

CascadeMap
Cascading Failure: When One Failure Becomes Many

The frontend is being built with Next.js, Tailwind CSS, and Leaflet. The backend is FastAPI.

IMPORTANT:
Design the frontend around the existing backend data contract. Do not invent unnecessary backend fields.

NODE:
{
  id: string,
  name: string,
  lat: float,
  lon: float,
  type: "junction" | "bridge" | "hospital" | "depot",
  population_weight: int
}

EDGE:
{
  id: string,
  from_node: node_id,
  to_node: node_id,
  weight: float,
  type: "road" | "bridge"
}

PHASE 1 API CONTRACT:

GET /network
Returns:
{
  nodes: [...],
  edges: [...]
}

POST /simulate-failure
Request:
{
  failed_ids: ["id1", "id2"]
}

Response:
{
  affected_routes: [...],
  stranded_nodes: [...],
  impact_score: number
}

GET /criticality
Returns:
[
  {
    node_id,
    centrality_score
  }
]

POST /explain
Receives the simulation output and returns:
{
  narrative: string,
  recommendation: string
}

The interface must support the complete Phase 1 user journey:

LOAD APPLICATION
→ LOAD NETWORK
→ SELECT NODE OR EDGE
→ SHOW FAILURE ACTION
→ SIMULATE FAILURE
→ SHOW FAILED ELEMENT
→ SHOW AFFECTED ROUTES
→ SHOW STRANDED NODES
→ UPDATE IMPACT STATISTICS
→ SHOW AI INCIDENT BRIEF
→ SHOW RECOMMENDATION
→ SHOW BEFORE AND AFTER COMPARISON
→ SHOW TOP 5 CRITICAL ASSETS
→ RESET TO BASELINE

VISUAL DIRECTION:

Create a sophisticated dark emergency operations center interface.

The visual language should feel like:
• disaster response command center
• critical infrastructure monitoring
• aerospace operations dashboard
• modern geospatial intelligence platform
• premium technical visualization

Avoid:
• generic SaaS dashboard appearance
• excessive cards
• excessive gradients
• childish map styling
• neon cyberpunk aesthetics
• excessive glassmorphism
• unnecessary decorative elements

Use a restrained dark interface with near black navy backgrounds, subtle borders, muted text, and carefully controlled accent colors.

Use color semantically:

GREEN = healthy / stable
AMBER = degraded / warning
RED = failed / critical
CYAN = selected / informational / network activity
PURPLE = primary action or simulation control

Typography should be highly legible and technical without becoming overly futuristic.

Use a strong display typeface for major headings and a clean sans serif for interface text. Small technical labels may use a monospace typeface.

The interface should have excellent spacing, alignment, hierarchy, and visual rhythm.

DESKTOP PRIMARY LAYOUT:

Create a 1440 × 900 desktop application.

Top navigation/header:
• CascadeMap wordmark
• small status indicator showing SYSTEM ONLINE
• scenario selector
• simulation controls
• reset control
• compact system status information

Main workspace:

LEFT / CENTER:
Large interactive geospatial map occupying approximately 70 percent of the application width.

RIGHT:
Analysis panel occupying approximately 30 percent.

The map should be the dominant visual element.

MAP:

Create a dark stylized city map rather than a normal Google Maps appearance.

Use:
• subtle geographic grid
• understated coastline or water region
• very faint road geography
• minimal labels
• no unnecessary visual clutter

Render the infrastructure network prominently over the geographic background.

Edges:
• normal roads are muted
• bridge edges have a distinct but subtle visual treatment
• selected edges glow slightly
• affected routes become highlighted
• failed routes become red
• rerouted routes become cyan or another clearly distinct color

Nodes:
• junctions use simple circular markers
• bridges use a distinct bridge symbol
• hospitals use a medical symbol
• depots use a logistics symbol
• failed nodes become red
• stranded nodes use a separate visual state
• selected nodes receive a clear cyan selection ring

Do not rely only on color to communicate states. Use icons, shapes, labels, and subtle animation.

Add a compact map legend.

Add zoom controls and a reset view control.

Provide a "Show Labels" or "Asset Labels" control that can hide labels when the map becomes visually dense.

TOP MAP OVERLAY:

Add a compact scenario control area:

Scenario
[ Select infrastructure asset ]

[ Simulate Failure ]

The simulation button should become visually prominent only when an asset is selected.

SELECTION STATE:

When the user clicks a node or edge:

Show a compact floating asset information panel containing:

Asset name
Asset type
Asset ID
Current status

Then show:

[ Simulate Failure ]

The selection state must clearly communicate what will fail before the user confirms the simulation.

SIMULATION STATE:

When simulation starts:

Show a subtle loading state.

Do not freeze the entire interface.

Use a small status indicator such as:

ANALYZING NETWORK

Then transition into the failure result state.

FAILED ELEMENT:

The failed node or edge becomes red.

Affected routes should animate or transition into their affected state.

Stranded nodes should receive a visually distinct marker.

The visual hierarchy should immediately communicate:

What failed
What was affected
What became disconnected
How serious the impact is

RIGHT ANALYSIS PANEL:

Create a persistent analysis panel.

Default state:

NETWORK STATUS

SYSTEM HEALTH
Stable

Selected Asset
None selected

Network
Operational

Instruction:
Select an infrastructure asset to simulate a failure.

After simulation:

Title:
INCIDENT ANALYSIS

Show:

FAILED ASSET
asset name

CRITICALITY
3 / 5

IMPACT SCORE
large prominent number

AFFECTED ROUTES
number

STRANDED NODES
number

POPULATION IMPACT
number based only on available backend data

Use a strong visual severity indicator.

Create a section:

WHY THIS MATTERS

Use the AI narrative returned from /explain.

Then:

RECOMMENDED ACTION

Display the AI recommendation.

The AI section must clearly look like an analytical explanation rather than pretending the AI calculated the simulation itself.

BEFORE / AFTER COMPARISON:

Create a polished comparison component showing:

BASELINE
vs
AFTER FAILURE

Include:
• network status
• affected routes
• stranded nodes
• impact score

Allow the user to visually compare the network state.

Do not create fake statistics that are not supported by the backend.

CRITICALITY LEADERBOARD:

Create a section titled:

TOP 5 CRITICAL ASSETS

Display the five highest criticality assets from GET /criticality.

Each row should contain:

Rank
Asset name
Asset type
Centrality score
Visual criticality indicator

Make the ranking visually strong but compact.

Use a podium or ranked list style only if it improves clarity. Do not make it look like a sports leaderboard.

TIMELINE / SIMULATION HISTORY:

For Phase 1, create a subtle before and after state rather than pretending that a multi round cascade already exists.

However, visually reserve a future expandable area for Phase 2 cascade replay.

The Phase 2 area may be labelled:

CASCADE TIMELINE
Phase 2

It should not imply that Phase 2 functionality exists yet.

RESPONSIVE BEHAVIOR:

Design desktop first.

Also create a tablet layout.

For smaller screens:
• stack the analysis panel below the map
• keep the simulation controls accessible
• preserve map usability
• prevent information overload

STATES TO DESIGN:

Create separate frames for:

1. Initial application
2. Network loaded
3. Node selected
4. Edge selected
5. Simulation loading
6. Failure result
7. High impact failure
8. Stranded node result
9. AI explanation loaded
10. Before and after comparison
11. Criticality leaderboard
12. Reset state
13. API error state
14. Network loading state
15. Empty selection state

INTERACTION DESIGN:

Click node:
Select node.

Click edge:
Select edge.

Selected asset:
Reveal Simulate Failure action.

Simulate Failure:
Send failed_ids to the backend.

Simulation response:
Update map and analysis panel.

Reset:
Return to the original network state.

Use smooth transitions but keep them fast and purposeful.

Do not use excessive animation.

ACCESSIBILITY:

Maintain strong contrast.

Do not communicate critical states only through color.

Provide clear hover, focus, selected, loading, success, warning, and error states.

Keep text readable at normal desktop viewing distance.

IMPORTANT IMPLEMENTATION CONSTRAINT:

The Figma design must be realistic to implement in Next.js + Tailwind + Leaflet.

Do not design interactions that require an entirely different technology stack.

Do not invent additional API requirements.

Do not invent additional node or edge fields.

Derive visual styling from the existing node type and edge type fields.

The design should feel premium enough for a hackathon final presentation while remaining technically realistic.

REFERENCE:

Use the provided existing CascadeMap screenshot as the functional reference for information architecture and general map plus analysis layout.

However, substantially polish the visual design.

Improve:
• typography
• spacing
• hierarchy
• map presentation
• status visualization
• failure visualization
• analysis panel
• criticality leaderboard
• simulation controls
• empty states
• loading states
• error states
• before and after comparison
• overall consistency

The final result should look like a serious infrastructure resilience command center that a city emergency operations team could plausibly use.

Prioritize visual clarity and the map as the hero element.

The application should communicate the core idea within five seconds:

ONE FAILURE
→ CASCADING IMPACT
→ HUMAN CONSEQUENCES
→ ACTIONABLE RESPONSE