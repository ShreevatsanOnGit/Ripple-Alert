import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeType = 'junction' | 'bridge' | 'hospital' | 'depot'

interface NodeData {
  id: string
  name: string
  x: number
  y: number
  type: NodeType
  population_weight: number
}

interface EdgeData {
  id: string
  from_node: string
  to_node: string
  weight: number
  type: 'road' | 'bridge'
}

interface SimResult {
  affected_routes: string[]
  stranded_nodes: string[]
  impact_score: number
}

interface Explanation {
  narrative: string
  recommendation: string
}

interface CriticalityItem {
  node_id: string
  centrality_score: number
}

type Selected = { kind: 'node'; data: NodeData } | { kind: 'edge'; data: EdgeData }
type Phase = 'idle' | 'selected' | 'simulating' | 'result'

// ── Mock Data ─────────────────────────────────────────────────────────────────

const NODES: NodeData[] = [
  { id: 'j5', name: 'West Junction',        x: 118, y: 278, type: 'junction', population_weight: 6500  },
  { id: 'd1', name: 'North Depot',           x: 138, y: 163, type: 'depot',    population_weight: 1200  },
  { id: 'h1', name: 'City General Hospital', x: 128, y: 432, type: 'hospital', population_weight: 8500  },
  { id: 'b1', name: 'Thames Bridge',         x: 272, y: 208, type: 'bridge',   population_weight: 0     },
  { id: 'j1', name: 'Central Junction',      x: 445, y: 268, type: 'junction', population_weight: 12000 },
  { id: 'j2', name: 'North Junction',        x: 445, y: 155, type: 'junction', population_weight: 8500  },
  { id: 'j4', name: 'South Junction',        x: 445, y: 432, type: 'junction', population_weight: 9800  },
  { id: 'j3', name: 'East Junction',         x: 612, y: 268, type: 'junction', population_weight: 7200  },
  { id: 'j6', name: 'Industrial Junction',   x: 618, y: 155, type: 'junction', population_weight: 3200  },
  { id: 'd2', name: 'East Logistics Hub',    x: 768, y: 268, type: 'depot',    population_weight: 900   },
  { id: 'b2', name: 'Victoria Bridge',       x: 530, y: 445, type: 'bridge',   population_weight: 0     },
  { id: 'h2', name: 'Riverside Medical',     x: 662, y: 456, type: 'hospital', population_weight: 6200  },
]

const EDGES: EdgeData[] = [
  { id: 'e1',  from_node: 'j5', to_node: 'd1', weight: 1.2, type: 'road'   },
  { id: 'e2',  from_node: 'j5', to_node: 'h1', weight: 1.0, type: 'road'   },
  { id: 'e3',  from_node: 'h1', to_node: 'b1', weight: 0.8, type: 'road'   },
  { id: 'e4',  from_node: 'j5', to_node: 'b1', weight: 0.9, type: 'road'   },
  { id: 'e5',  from_node: 'b1', to_node: 'j1', weight: 0.6, type: 'bridge' },
  { id: 'e6',  from_node: 'j1', to_node: 'j2', weight: 0.7, type: 'road'   },
  { id: 'e7',  from_node: 'j1', to_node: 'j4', weight: 0.8, type: 'road'   },
  { id: 'e8',  from_node: 'j1', to_node: 'j3', weight: 1.0, type: 'road'   },
  { id: 'e9',  from_node: 'j2', to_node: 'j6', weight: 1.3, type: 'road'   },
  { id: 'e10', from_node: 'j3', to_node: 'j6', weight: 0.8, type: 'road'   },
  { id: 'e11', from_node: 'j3', to_node: 'd2', weight: 1.1, type: 'road'   },
  { id: 'e12', from_node: 'j4', to_node: 'b2', weight: 0.6, type: 'road'   },
  { id: 'e13', from_node: 'b2', to_node: 'h2', weight: 0.5, type: 'bridge' },
]

const CRITICALITY: CriticalityItem[] = [
  { node_id: 'j1', centrality_score: 0.94 },
  { node_id: 'b1', centrality_score: 0.82 },
  { node_id: 'j4', centrality_score: 0.71 },
  { node_id: 'j3', centrality_score: 0.63 },
  { node_id: 'b2', centrality_score: 0.54 },
]

// ── Graph computation ─────────────────────────────────────────────────────────

function computeFailure(failedIds: string[]): SimResult {
  const failedNodeSet = new Set(failedIds.filter(id => NODES.some(n => n.id === id)))
  const failedEdgeSet = new Set(failedIds.filter(id => EDGES.some(e => e.id === id)))

  const activeNodes = NODES.filter(n => !failedNodeSet.has(n.id))
  const activeEdges = EDGES.filter(
    e => !failedEdgeSet.has(e.id) && !failedNodeSet.has(e.from_node) && !failedNodeSet.has(e.to_node)
  )

  const adj = new Map<string, string[]>()
  for (const n of activeNodes) adj.set(n.id, [])
  for (const e of activeEdges) {
    adj.get(e.from_node)?.push(e.to_node)
    adj.get(e.to_node)?.push(e.from_node)
  }

  // Find all connected components, pick the largest as "main network"
  const unvisited = new Set(activeNodes.map(n => n.id))
  const components: string[][] = []
  while (unvisited.size > 0) {
    const start = unvisited.values().next().value as string
    const comp: string[] = []
    const queue = [start]
    while (queue.length > 0) {
      const curr = queue.shift()!
      if (!unvisited.has(curr)) continue
      unvisited.delete(curr)
      comp.push(curr)
      for (const nb of adj.get(curr) ?? []) {
        if (unvisited.has(nb)) queue.push(nb)
      }
    }
    components.push(comp)
  }
  const largestSet = new Set(
    (components.sort((a, b) => b.length - a.length)[0] ?? [])
  )

  const stranded = activeNodes.filter(n => !largestSet.has(n.id)).map(n => n.id)
  const affected_routes = EDGES.filter(
    e =>
      failedEdgeSet.has(e.id) ||
      failedNodeSet.has(e.from_node) ||
      failedNodeSet.has(e.to_node) ||
      stranded.includes(e.from_node) ||
      stranded.includes(e.to_node)
  ).map(e => e.id)

  const pop_impact = [...stranded, ...failedIds]
    .map(id => NODES.find(n => n.id === id)?.population_weight ?? 0)
    .reduce((a, b) => a + b, 0)

  const impact_score = Math.round(pop_impact + affected_routes.length * 800 + stranded.length * 2000)
  return { affected_routes, stranded_nodes: stranded, impact_score }
}

function generateExplanation(result: SimResult, failedIds: string[]): Explanation {
  const failedNode = NODES.find(n => failedIds.includes(n.id))
  const strandedNodes = NODES.filter(n => result.stranded_nodes.includes(n.id))
  const hospitals = strandedNodes.filter(n => n.type === 'hospital')

  if (failedNode?.id === 'b1') {
    return {
      narrative: `The failure of Thames Bridge has severed the primary western arterial crossing, cutting ${strandedNodes.length} infrastructure nodes from the main network. City General Hospital is no longer accessible via standard routes, creating a critical gap in emergency medical coverage for the western district. Supply chain operations at North Depot are suspended, affecting logistics for an estimated ${result.impact_score.toLocaleString()} residents.`,
      recommendation: `Activate emergency vehicle routing via the southern network corridor. Deploy mobile medical units to City General Hospital immediately. Issue a Level 2 Traffic Management Notice redirecting civilian traffic. Initiate bridge structural assessment and coordinate with civil engineering for expedited repair.`,
    }
  }
  if (failedNode?.id === 'j1') {
    return {
      narrative: `Central Junction failure has triggered a catastrophic network partition. As the primary routing hub, its loss has isolated ${result.stranded_nodes.length} nodes including critical healthcare infrastructure on both sides of the network. The western district and south hospital corridor are unreachable from the main operational network, representing a cascading impact on approximately ${result.impact_score.toLocaleString()} residents.`,
      recommendation: `Declare a Critical Infrastructure Emergency. Activate all alternate evacuation routes immediately. Establish emergency staging areas at East and North junctions. Initiate helicopter medical evacuation for Riverside Medical. Begin emergency bypass construction at highest priority and alert neighboring districts to prepare mutual aid resources.`,
    }
  }
  if (hospitals.length > 0) {
    return {
      narrative: `This failure has isolated ${hospitals.length} hospital ${hospitals.length === 1 ? 'facility' : 'facilities'} from the primary network. ${hospitals.map(h => h.name).join(' and ')} ${hospitals.length === 1 ? 'is' : 'are'} now unreachable via standard routes. Emergency medical response capability is critically degraded across ${result.affected_routes.length} compromised route segments, with cascading risk to adjacent infrastructure.`,
      recommendation: `Activate emergency medical bypass protocols immediately. Establish alternative access routes to affected hospital facilities. Alert all hospital facilities to initiate internal emergency response procedures. Deploy mobile emergency command units and establish forward operating positions.`,
    }
  }
  return {
    narrative: `The infrastructure failure has disrupted ${result.affected_routes.length} route segments across the network. ${result.stranded_nodes.length > 0 ? `${result.stranded_nodes.length} nodes have been isolated, creating routing gaps that will compound as load redistributes across remaining infrastructure.` : 'The network remains largely connected but load redistribution is occurring across adjacent segments.'} Cascading risk to dependent infrastructure requires active monitoring.`,
    recommendation: `Monitor adjacent network segments for increased load and potential secondary failures. Dispatch maintenance assessment teams to the affected area. Prepare contingency routing plans and notify logistics operators of service disruptions. Update incident status with local emergency management.`,
  }
}

// ── Visual helpers ────────────────────────────────────────────────────────────

const NODE_BASE_COLORS: Record<NodeType, string> = {
  junction: '#3b82f6',
  bridge:   '#8b5cf6',
  hospital: '#22c55e',
  depot:    '#f59e0b',
}

function resolveNodeColor(type: NodeType, failed: boolean, stranded: boolean, selected: boolean) {
  if (failed)   return '#ef4444'
  if (stranded) return '#a855f7'
  if (selected) return '#06b6d4'
  return NODE_BASE_COLORS[type]
}

function NodeShape({ node, color, r = 12 }: { node: NodeData; color: string; r?: number }) {
  const { x, y, type } = node
  if (type === 'junction') {
    return <circle cx={x} cy={y} r={r * 0.85} fill={color} />
  }
  if (type === 'bridge') {
    return (
      <polygon
        points={`${x},${y - r} ${x + r * 0.85},${y} ${x},${y + r} ${x - r * 0.85},${y}`}
        fill={color}
      />
    )
  }
  if (type === 'hospital') {
    const arm = r * 0.58
    const thick = r * 0.22
    return (
      <>
        <circle cx={x} cy={y} r={r} fill={color} />
        <rect x={x - arm} y={y - thick} width={arm * 2} height={thick * 2} fill="white" rx={1} />
        <rect x={x - thick} y={y - arm} width={thick * 2} height={arm * 2} fill="white" rx={1} />
      </>
    )
  }
  // depot
  const s = r * 0.85
  return (
    <>
      <rect x={x - s} y={y - s} width={s * 2} height={s * 2} fill={color} rx={2} />
      <polygon
        points={`${x - s * 0.45},${y + s * 0.3} ${x + s * 0.45},${y + s * 0.3} ${x},${y - s * 0.38}`}
        fill="rgba(255,255,255,0.55)"
      />
    </>
  )
}

function TypeBadge({ type }: { type: string }) {
  const c: Record<string, string> = {
    junction: '#3b82f6', bridge: '#8b5cf6',
    hospital: '#22c55e', depot: '#f59e0b', road: '#3b82f6',
  }
  const col = c[type] ?? '#6b8299'
  return (
    <span
      className="font-mono text-xs uppercase px-1.5 py-0.5 rounded"
      style={{ color: col, background: `${col}20`, border: `1px solid ${col}40`, letterSpacing: '0.12em' }}
    >
      {type}
    </span>
  )
}

function SeverityBadge({ score }: { score: number }) {
  const level = score > 30000 ? 'CRITICAL' : score > 15000 ? 'HIGH' : score > 5000 ? 'MODERATE' : 'LOW'
  const col   = score > 30000 ? '#ef4444' : score > 15000 ? '#f59e0b' : score > 5000 ? '#f97316' : '#22c55e'
  return (
    <span
      className="font-mono text-xs px-2 py-1 rounded font-bold"
      style={{ background: `${col}20`, color: col, border: `1px solid ${col}50`, letterSpacing: '0.12em' }}
    >
      {level}
    </span>
  )
}

function StatusRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="font-mono text-xs" style={{ color: '#4a6280', letterSpacing: '0.1em' }}>{label}</span>
      <span className="font-mono text-xs" style={{ color, letterSpacing: '0.08em' }}>{value}</span>
    </div>
  )
}

function MetricCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center p-2.5 rounded" style={{ background: '#0a1628', border: '1px solid #0f2035' }}>
      <div className="font-mono mb-1" style={{ fontSize: 9, color: '#3a5570', letterSpacing: '0.12em' }}>{label}</div>
      <div className="font-display font-bold" style={{ fontSize: 22, color }}>{value}</div>
    </div>
  )
}

function ImpactBar({ score, max = 50000 }: { score: number; max?: number }) {
  const pct = Math.min((score / max) * 100, 100)
  const col  = pct > 66 ? '#ef4444' : pct > 33 ? '#f59e0b' : '#22c55e'
  return (
    <div className="h-1 rounded-full overflow-hidden mt-2" style={{ background: '#0d1e30' }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: col }} />
    </div>
  )
}

function CompareCol({ label, color, rows }: { label: string; color: string; rows: { k: string; v: string }[] }) {
  return (
    <div className="rounded p-3" style={{ background: '#090f1c', border: `1px solid ${color}22` }}>
      <div className="font-mono mb-2" style={{ fontSize: 9, color, letterSpacing: '0.15em' }}>{label}</div>
      {rows.map(r => (
        <div key={r.k} className="flex justify-between py-0.5">
          <span className="font-mono" style={{ fontSize: 9, color: '#3a5570', letterSpacing: '0.08em' }}>{r.k}</span>
          <span className="font-mono" style={{ fontSize: 10, color: '#7a9ab8', letterSpacing: '0.06em' }}>{r.v}</span>
        </div>
      ))}
    </div>
  )
}

function PanelDivider({ title }: { title: string }) {
  return (
    <div className="px-5 pt-4 pb-0">
      <div className="font-mono" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.22em' }}>{title}</div>
      <div className="mt-2" style={{ height: 1, background: '#0d1e30' }} />
    </div>
  )
}

function CriticalitySection({ criticality }: { criticality: CriticalityItem[] }) {
  return (
    <div className="px-5 py-4">
      <div className="font-mono mb-3" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.22em' }}>
        TOP 5 CRITICAL ASSETS
      </div>
      <div className="flex flex-col gap-2.5">
        {criticality.slice(0, 5).map((item, i) => {
          const node = NODES.find(n => n.id === item.node_id)
          if (!node) return null
          const barCol = item.centrality_score > 0.75 ? '#ef4444' : item.centrality_score > 0.5 ? '#f59e0b' : '#3b82f6'
          return (
            <div key={item.node_id} className="flex items-center gap-2.5">
              <div
                className="font-mono w-4 text-center shrink-0"
                style={{ fontSize: 10, color: i === 0 ? '#f59e0b' : '#2a4060', letterSpacing: '0.05em' }}
              >
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-mono truncate" style={{ fontSize: 10, color: '#8aaccc', letterSpacing: '0.06em' }}>
                    {node.name}
                  </div>
                  <div className="font-mono ml-2 shrink-0" style={{ fontSize: 10, color: barCol, letterSpacing: '0.06em' }}>
                    {item.centrality_score.toFixed(2)}
                  </div>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: '#0d1e30' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${item.centrality_score * 100}%`, background: barCol }}
                  />
                </div>
              </div>
              <TypeBadge type={node.type} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Analysis Panel ────────────────────────────────────────────────────────────

function AnalysisPanel({
  phase,
  selected,
  simResult,
  explanation,
  strandedNodeData,
  popImpact,
  selectedCriticality,
  onSimulate,
  networkLoading,
}: {
  phase: Phase
  selected: Selected | null
  simResult: SimResult | null
  explanation: Explanation | null
  strandedNodeData: NodeData[]
  popImpact: number
  selectedCriticality: number | undefined
  onSimulate: () => void
  networkLoading: boolean
}) {
  if (networkLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="font-mono" style={{ fontSize: 10, color: '#1e3550', letterSpacing: '0.18em' }}>
          LOADING...
        </div>
      </div>
    )
  }

  const selectedName =
    selected?.kind === 'node' ? selected.data.name : selected ? `Route ${selected.data.id.toUpperCase()}` : ''
  const selectedType =
    selected?.kind === 'node' ? selected.data.type : selected ? selected.data.type : ''

  return (
    <div className="flex flex-col min-h-0">
      {/* Panel header */}
      <div className="px-5 py-4 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid #0d1e30' }}>
        <div>
          <div className="font-display text-white font-semibold" style={{ fontSize: 15, letterSpacing: '0.06em' }}>
            {phase === 'result' ? 'INCIDENT ANALYSIS' : 'NETWORK STATUS'}
          </div>
          <div className="font-mono mt-0.5" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.15em' }}>
            {phase === 'result' ? 'FAILURE SIMULATION COMPLETE' : 'MONITORING ACTIVE'}
          </div>
        </div>
        {phase === 'result' && simResult && <SeverityBadge score={simResult.impact_score} />}
      </div>

      {/* ── IDLE ── */}
      {phase === 'idle' && (
        <>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #0d1e30' }}>
            <div className="font-mono mb-3" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.22em' }}>SYSTEM HEALTH</div>
            <StatusRow label="Network"     value="OPERATIONAL"         color="#22c55e" />
            <StatusRow label="Connections" value={`${EDGES.length} active`}     color="#3b82f6" />
            <StatusRow label="Nodes"       value={`${NODES.length} online`}     color="#22c55e" />
          </div>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #0d1e30' }}>
            <div className="font-mono mb-2" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.22em' }}>SELECTED ASSET</div>
            <div className="font-mono" style={{ fontSize: 10, color: '#1e3550', letterSpacing: '0.1em' }}>None selected</div>
          </div>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #0d1e30' }}>
            <p className="text-sm text-slate-500 leading-relaxed" style={{ fontFamily: 'Inter' }}>
              Select an infrastructure asset on the map to begin failure analysis.
            </p>
          </div>
          <PanelDivider title="" />
          <CriticalitySection criticality={CRITICALITY} />
        </>
      )}

      {/* ── SELECTED ── */}
      {phase === 'selected' && selected && (
        <>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #0d1e30' }}>
            <div className="font-mono mb-3" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.22em' }}>SELECTED ASSET</div>
            <div className="font-display text-white font-semibold mb-2" style={{ fontSize: 16 }}>
              {selectedName}
            </div>
            <div className="flex items-center gap-2 mb-3">
              <TypeBadge type={selectedType} />
              <span className="font-mono text-xs" style={{ color: '#2a4060', letterSpacing: '0.1em' }}>
                {selected.kind === 'node' ? selected.data.id : selected.data.id}
              </span>
            </div>
            {selected.kind === 'node' && (
              <>
                <StatusRow label="Status" value="OPERATIONAL" color="#22c55e" />
                {selected.data.population_weight > 0 && (
                  <StatusRow label="Population served" value={selected.data.population_weight.toLocaleString()} color="#8aaccc" />
                )}
                {selectedCriticality !== undefined && (
                  <div className="mt-3">
                    <div className="flex justify-between mb-1.5">
                      <span className="font-mono" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.15em' }}>CRITICALITY</span>
                      <span className="font-mono text-xs" style={{ color: '#f59e0b', letterSpacing: '0.06em' }}>
                        {(selectedCriticality * 5).toFixed(1)} / 5.0
                      </span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: '#0d1e30' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${selectedCriticality * 100}%`,
                          background: selectedCriticality > 0.7 ? '#ef4444' : selectedCriticality > 0.4 ? '#f59e0b' : '#22c55e',
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="px-5 py-4" style={{ borderBottom: '1px solid #0d1e30' }}>
            <button
              onClick={onSimulate}
              className="w-full font-display uppercase"
              style={{
                background: 'linear-gradient(135deg, #4c1d95, #6d28d9)',
                border: '1px solid #6d28d9',
                borderRadius: 6,
                padding: '13px',
                color: 'white',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.18em',
                cursor: 'pointer',
                boxShadow: '0 0 18px rgba(109,40,217,0.28)',
              }}
            >
              SIMULATE FAILURE
            </button>
            <div className="font-mono text-center mt-2" style={{ fontSize: 9, color: '#1e3550', letterSpacing: '0.1em' }}>
              WILL COMPUTE CASCADE IMPACT
            </div>
          </div>

          <PanelDivider title="" />
          <CriticalitySection criticality={CRITICALITY} />
        </>
      )}

      {/* ── SIMULATING ── */}
      {phase === 'simulating' && (
        <div className="flex-1 flex items-center justify-center px-5" style={{ minHeight: 240 }}>
          <div className="text-center">
            <div className="relative w-16 h-16 mx-auto mb-5">
              <svg width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="#1a2d45" strokeWidth="2"/>
                <circle cx="32" cy="32" r="28" fill="none" stroke="#7c3aed" strokeWidth="2"
                  strokeDasharray="44 132" strokeLinecap="round">
                  <animateTransform attributeName="transform" type="rotate"
                    values="0 32 32;360 32 32" dur="1.2s" repeatCount="indefinite"/>
                </circle>
                <circle cx="32" cy="32" r="18" fill="none" stroke="#1a2d45" strokeWidth="1.5"/>
                <circle cx="32" cy="32" r="18" fill="none" stroke="#4c1d95" strokeWidth="1.5"
                  strokeDasharray="28 84" strokeLinecap="round">
                  <animateTransform attributeName="transform" type="rotate"
                    values="360 32 32;0 32 32" dur="0.8s" repeatCount="indefinite"/>
                </circle>
                <circle cx="32" cy="32" r="4" fill="#7c3aed">
                  <animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite"/>
                </circle>
              </svg>
            </div>
            <div className="font-mono mb-1" style={{ fontSize: 12, color: '#a78bfa', letterSpacing: '0.2em' }}>ANALYZING</div>
            <div className="font-mono" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.15em' }}>CASCADE PROPAGATION</div>
          </div>
        </div>
      )}

      {/* ── RESULT ── */}
      {phase === 'result' && simResult && selected && (
        <>
          {/* Failed asset */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #0d1e30' }}>
            <div className="font-mono mb-3" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.22em' }}>FAILED ASSET</div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0 status-blink" />
              <div>
                <div className="font-display text-red-300 font-semibold mb-1.5" style={{ fontSize: 15 }}>
                  {selectedName}
                </div>
                <TypeBadge type={selectedType} />
              </div>
            </div>
            {selectedCriticality !== undefined && (
              <div className="mt-3">
                <div className="flex justify-between mb-1.5">
                  <span className="font-mono" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.15em' }}>CRITICALITY SCORE</span>
                  <span className="font-mono text-xs" style={{ color: '#f59e0b' }}>
                    {(selectedCriticality * 5).toFixed(1)} / 5.0
                  </span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: '#0d1e30' }}>
                  <div className="h-full rounded-full" style={{ width: `${selectedCriticality * 100}%`, background: '#f59e0b' }} />
                </div>
              </div>
            )}
          </div>

          {/* Impact metrics */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #0d1e30' }}>
            <div className="font-mono mb-3" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.22em' }}>IMPACT ASSESSMENT</div>
            <div className="text-center py-4 mb-3 rounded" style={{ background: '#0b0a1e', border: '1px solid #22103a' }}>
              <div className="font-mono mb-1" style={{ fontSize: 9, color: '#3a2060', letterSpacing: '0.18em' }}>IMPACT SCORE</div>
              <div className="font-display font-bold text-red-400" style={{ fontSize: 42, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
                {simResult.impact_score.toLocaleString()}
              </div>
              <ImpactBar score={simResult.impact_score} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetricCell label="ROUTES"     value={String(simResult.affected_routes.length)}         color="#f59e0b" />
              <MetricCell label="STRANDED"   value={String(simResult.stranded_nodes.length)}          color="#a855f7" />
              <MetricCell label="POPULATION" value={popImpact > 0 ? popImpact.toLocaleString() : '—'} color="#ef4444" />
            </div>
            {strandedNodeData.length > 0 && (
              <div className="mt-3">
                <div className="font-mono mb-2" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.15em' }}>STRANDED NODES</div>
                <div className="flex flex-wrap gap-1.5">
                  {strandedNodeData.map(n => (
                    <span
                      key={n.id}
                      className="font-mono text-xs px-2 py-0.5 rounded"
                      style={{ color: '#c084fc', background: '#1a0a30', border: '1px solid #3b1d60', letterSpacing: '0.08em' }}
                    >
                      {n.name.split(' ').slice(0, 2).join(' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Before / After */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #0d1e30' }}>
            <div className="font-mono mb-3" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.22em' }}>
              BEFORE / AFTER COMPARISON
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CompareCol
                label="BASELINE"
                color="#22c55e"
                rows={[
                  { k: 'NETWORK',  v: 'STABLE'                   },
                  { k: 'ROUTES',   v: String(EDGES.length)        },
                  { k: 'STRANDED', v: '0'                         },
                  { k: 'SCORE',    v: '0'                         },
                ]}
              />
              <CompareCol
                label="AFTER FAILURE"
                color="#ef4444"
                rows={[
                  { k: 'NETWORK',  v: simResult.stranded_nodes.length > 3 ? 'CRITICAL' : 'DEGRADED'                        },
                  { k: 'ROUTES',   v: String(EDGES.length - simResult.affected_routes.length)                               },
                  { k: 'STRANDED', v: String(simResult.stranded_nodes.length)                                               },
                  { k: 'SCORE',    v: simResult.impact_score.toLocaleString()                                               },
                ]}
              />
            </div>
          </div>

          {/* AI narrative */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #0d1e30' }}>
            <div className="font-mono mb-3" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.22em' }}>WHY THIS MATTERS</div>
            {explanation ? (
              <p className="text-sm leading-relaxed text-slate-400 animate-fade-in" style={{ fontFamily: 'Inter' }}>
                {explanation.narrative}
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 status-blink" />
                <span className="font-mono" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.12em' }}>
                  GENERATING ANALYSIS...
                </span>
              </div>
            )}
          </div>

          {/* Recommendation */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid #0d1e30' }}>
            <div className="font-mono mb-3" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.22em' }}>RECOMMENDED ACTION</div>
            {explanation ? (
              <p
                className="text-sm leading-relaxed text-slate-400 animate-fade-in p-3 rounded"
                style={{ fontFamily: 'Inter', background: '#071828', border: '1px solid #0e3050' }}
              >
                {explanation.recommendation}
              </p>
            ) : (
              <div className="font-mono" style={{ fontSize: 9, color: '#1e3550', letterSpacing: '0.1em' }}>
                PENDING ANALYSIS...
              </div>
            )}
          </div>

          <PanelDivider title="" />
          <CriticalitySection criticality={CRITICALITY} />

          {/* Phase 2 placeholder */}
          <div className="px-5 py-4">
            <div className="rounded p-3" style={{ background: '#080f1a', border: '1px dashed #0f2035' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="font-mono" style={{ fontSize: 9, color: '#1e3550', letterSpacing: '0.18em' }}>
                  CASCADE TIMELINE
                </div>
                <span
                  className="font-mono px-1.5 py-0.5 rounded"
                  style={{ fontSize: 8, background: '#0d1e30', color: '#2a4060', letterSpacing: '0.12em' }}
                >
                  PHASE 2
                </span>
              </div>
              <div className="font-mono" style={{ fontSize: 9, color: '#162030', letterSpacing: '0.08em', lineHeight: 1.5 }}>
                Multi-round cascade replay and timeline animation will be available in the next release.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Map control button ────────────────────────────────────────────────────────

function MapBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="w-8 h-8 flex items-center justify-center hover:bg-slate-800 transition-colors"
      style={{ color: '#4a6a8a', fontSize: 15, background: 'transparent', border: 'none', cursor: 'pointer' }}
    >
      {label}
    </button>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

const VIEW_BOXES = [
  '0 0 900 600',
  '112 75 676 450',
  '225 150 450 300',
]

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [selected, setSelected] = useState<Selected | null>(null)
  const [simResult, setSimResult] = useState<SimResult | null>(null)
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [networkLoading, setNetworkLoading] = useState(true)
  const [zoomLevel, setZoomLevel] = useState(0)
  const [viewBox, setViewBox] = useState(VIEW_BOXES[0])
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setTimeout(() => setNetworkLoading(false), 1700)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 5000)
    return () => clearInterval(t)
  }, [])

  const handleSelectNode = useCallback(
    (node: NodeData) => {
      if (phase === 'simulating') return
      setSelected({ kind: 'node', data: node })
      setPhase('selected')
      setSimResult(null)
      setExplanation(null)
    },
    [phase]
  )

  const handleSelectEdge = useCallback(
    (edge: EdgeData) => {
      if (phase === 'simulating') return
      setSelected({ kind: 'edge', data: edge })
      setPhase('selected')
      setSimResult(null)
      setExplanation(null)
    },
    [phase]
  )

  const handleSimulate = useCallback(async () => {
    if (!selected) return
    setPhase('simulating')
    await new Promise(r => setTimeout(r, 1900))
    const failedId = selected.kind === 'node' ? selected.data.id : selected.data.id
    const result = computeFailure([failedId])
    setSimResult(result)
    setPhase('result')
    await new Promise(r => setTimeout(r, 700))
    setExplanation(generateExplanation(result, [failedId]))
  }, [selected])

  const handleReset = useCallback(() => {
    setPhase('idle')
    setSelected(null)
    setSimResult(null)
    setExplanation(null)
    setZoomLevel(0)
    setViewBox(VIEW_BOXES[0])
  }, [])

  const handleZoom = (dir: 1 | -1) => {
    const next = Math.max(0, Math.min(2, zoomLevel + dir))
    setZoomLevel(next)
    setViewBox(VIEW_BOXES[next])
  }

  // Derive visual states
  const failedId = phase === 'result' && selected
    ? (selected.kind === 'node' ? selected.data.id : selected.data.id)
    : null
  const affectedRoutes = simResult?.affected_routes ?? []
  const strandedNodes  = simResult?.stranded_nodes  ?? []

  const getNodeState = (id: string) => {
    if (phase === 'result') {
      if (id === failedId) return 'failed'
      if (strandedNodes.includes(id)) return 'stranded'
    }
    if (selected?.kind === 'node' && selected.data.id === id) return 'selected'
    return 'normal'
  }

  const getEdgeState = (id: string) => {
    if (phase === 'result') {
      if (id === failedId) return 'failed'
      if (affectedRoutes.includes(id)) return 'affected'
    }
    if (selected?.kind === 'edge' && selected.data.id === id) return 'selected'
    return 'normal'
  }

  const selectedCriticality = selected?.kind === 'node'
    ? CRITICALITY.find(c => c.node_id === selected.data.id)?.centrality_score
    : undefined

  const strandedNodeData = NODES.filter(n => strandedNodes.includes(n.id))
  const popImpact =
    strandedNodeData.reduce((s, n) => s + n.population_weight, 0) +
    (selected?.kind === 'node' ? (phase === 'result' ? selected.data.population_weight : 0) : 0)

  const utcTime = now.toISOString().slice(11, 19) + ' UTC'

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ height: '100dvh', background: '#060c15', color: '#b8ccde' }}
    >
      {/* ── Header ── */}
      <header
        className="flex items-center gap-5 px-5 shrink-0"
        style={{ height: 52, background: '#07101e', borderBottom: '1px solid #0d1e30' }}
      >
        {/* Wordmark */}
        <div className="flex items-center gap-2.5">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <polygon points="10,1.5 18.5,6.25 18.5,13.75 10,18.5 1.5,13.75 1.5,6.25"
              fill="none" stroke="#06b6d4" strokeWidth="1.3"/>
            <polygon points="10,5.5 15,8.5 15,13 10,16 5,13 5,8.5"
              fill="#0a1f38" stroke="#2563eb" strokeWidth="1"/>
            <circle cx="10" cy="10" r="2.5" fill="#06b6d4"/>
          </svg>
          <span className="font-display text-white" style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.22em' }}>
            CASCADEMAP
          </span>
        </div>

        {/* Status */}
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${networkLoading ? 'bg-amber-400 status-blink' : 'bg-emerald-400'}`} />
          <span className="font-mono" style={{ fontSize: 10, color: networkLoading ? '#f59e0b' : '#22c55e', letterSpacing: '0.14em' }}>
            {networkLoading ? 'INITIALIZING' : 'SYSTEM ONLINE'}
          </span>
        </div>

        {!networkLoading && (
          <>
            <div style={{ width: 1, height: 16, background: '#0f2035' }} />
            <div className="flex items-center gap-4">
              {[
                ['NODES', String(NODES.length), '#4a6a8a'],
                ['EDGES', String(EDGES.length), '#4a6a8a'],
                ['NETWORK', 'OPERATIONAL',     '#22c55e'],
              ].map(([lbl, val, col]) => (
                <div key={lbl} className="flex items-center gap-1.5">
                  <span className="font-mono" style={{ fontSize: 9, color: '#2a4060', letterSpacing: '0.12em' }}>{lbl}</span>
                  <span className="font-mono" style={{ fontSize: 9, color: col, letterSpacing: '0.08em' }}>{val}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex-1" />

        {/* Simulation indicator */}
        {phase === 'simulating' && (
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400 status-blink" />
            <span className="font-mono" style={{ fontSize: 10, color: '#a78bfa', letterSpacing: '0.14em' }}>
              ANALYZING NETWORK
            </span>
          </div>
        )}

        {/* Reset */}
        {(phase === 'result' || phase === 'selected') && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors hover:bg-slate-800"
            style={{ border: '1px solid #1e3550', cursor: 'pointer', background: 'transparent' }}
          >
            <span className="font-mono" style={{ fontSize: 9, color: '#4a6a8a', letterSpacing: '0.14em' }}>
              RESET BASELINE
            </span>
          </button>
        )}

        <span className="font-mono" style={{ fontSize: 9, color: '#1e3040', letterSpacing: '0.12em' }}>
          {utcTime}
        </span>
      </header>

      {/* ── Main workspace ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Map panel ── */}
        <div className="relative flex-1 overflow-hidden" style={{ background: '#060c15' }}>

          {/* Loading overlay */}
          {networkLoading && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center"
              style={{ background: '#060c15' }}
            >
              <div className="flex flex-col items-center gap-5">
                <svg width="56" height="56" viewBox="0 0 56 56">
                  <polygon points="28,3 52,16 52,40 28,53 4,40 4,16"
                    fill="none" stroke="#06b6d4" strokeWidth="1.5">
                    <animate attributeName="opacity" values="0.2;0.9;0.2" dur="1.6s" repeatCount="indefinite"/>
                  </polygon>
                  <polygon points="28,10 44,19 44,37 28,46 12,37 12,19"
                    fill="none" stroke="#2563eb" strokeWidth="1">
                    <animate attributeName="opacity" values="0.9;0.2;0.9" dur="1.6s" repeatCount="indefinite"/>
                  </polygon>
                  <circle cx="28" cy="28" r="5" fill="#06b6d4">
                    <animate attributeName="r" values="4;6.5;4" dur="1.6s" repeatCount="indefinite"/>
                  </circle>
                </svg>
                <div className="font-mono" style={{ fontSize: 11, color: '#06b6d4', letterSpacing: '0.24em' }}>
                  LOADING NETWORK
                </div>
                <div className="font-mono" style={{ fontSize: 9, color: '#1e3050', letterSpacing: '0.14em' }}>
                  INITIALIZING INFRASTRUCTURE DATA
                </div>
              </div>
            </div>
          )}

          {/* Map overlays */}
          {!networkLoading && (
            <div className="absolute top-4 left-4 right-4 z-10 flex items-start gap-3 pointer-events-none">
              {/* Left card: selected / simulating / result status */}
              <div className="pointer-events-auto" style={{ minWidth: 220 }}>
                {selected && phase === 'selected' && (
                  <div
                    className="animate-fade-in"
                    style={{
                      background: 'rgba(6,12,21,0.92)',
                      border: '1px solid #0d2540',
                      borderRadius: 6,
                      padding: '11px 14px',
                      backdropFilter: 'blur(10px)',
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      <span className="font-mono" style={{ fontSize: 9, color: '#06b6d4', letterSpacing: '0.18em' }}>
                        ASSET SELECTED
                      </span>
                    </div>
                    <div className="font-display text-white font-semibold mb-1.5" style={{ fontSize: 14 }}>
                      {selected.kind === 'node' ? selected.data.name : `Route ${selected.data.id.toUpperCase()}`}
                    </div>
                    <TypeBadge type={selected.kind === 'node' ? selected.data.type : selected.data.type} />
                  </div>
                )}

                {phase === 'simulating' && (
                  <div
                    className="animate-fade-in"
                    style={{
                      background: 'rgba(30,10,60,0.88)',
                      border: '1px solid #3b1d70',
                      borderRadius: 6,
                      padding: '11px 14px',
                      backdropFilter: 'blur(10px)',
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-400 status-blink" />
                      <span className="font-mono" style={{ fontSize: 9, color: '#a78bfa', letterSpacing: '0.18em' }}>
                        ANALYZING TOPOLOGY
                      </span>
                    </div>
                    <div className="font-mono" style={{ fontSize: 9, color: '#3a2060', letterSpacing: '0.12em' }}>
                      SIMULATING CASCADE PROPAGATION...
                    </div>
                  </div>
                )}

                {phase === 'result' && simResult && (
                  <div
                    className="animate-fade-in"
                    style={{
                      background: 'rgba(20,4,4,0.90)',
                      border: '1px solid #3a0e0e',
                      borderRadius: 6,
                      padding: '11px 14px',
                      backdropFilter: 'blur(10px)',
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      <span className="font-mono" style={{ fontSize: 9, color: '#ef4444', letterSpacing: '0.18em' }}>
                        FAILURE SIMULATED
                      </span>
                    </div>
                    <div className="flex gap-5">
                      {[
                        ['IMPACT',  simResult.impact_score.toLocaleString(), '#f87171'],
                        ['STRANDED', String(simResult.stranded_nodes.length), '#c084fc'],
                        ['ROUTES',  String(simResult.affected_routes.length), '#fbbf24'],
                      ].map(([lbl, val, col]) => (
                        <div key={lbl}>
                          <div className="font-mono" style={{ fontSize: 8, color: '#2a1010', letterSpacing: '0.1em' }}>{lbl}</div>
                          <div className="font-display font-bold" style={{ fontSize: 20, color: col, lineHeight: 1.1 }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1" />

              {/* Simulate button */}
              {phase === 'selected' && selected && (
                <button
                  onClick={handleSimulate}
                  className="pointer-events-auto font-display uppercase animate-fade-in"
                  style={{
                    background: 'linear-gradient(135deg, #5b21b6, #7c3aed)',
                    border: '1px solid #7c3aed',
                    borderRadius: 6,
                    padding: '10px 18px',
                    color: 'white',
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.18em',
                    cursor: 'pointer',
                    boxShadow: '0 0 22px rgba(124,58,237,0.32)',
                  }}
                >
                  SIMULATE FAILURE
                </button>
              )}
            </div>
          )}

          {/* ── SVG Map ── */}
          <svg
            viewBox={viewBox}
            style={{ width: '100%', height: '100%', display: 'block', transition: 'viewBox 0.4s' }}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <pattern id="cityGrid" x="0" y="0" width="52" height="52" patternUnits="userSpaceOnUse">
                <rect x="1.2" y="1.2" width="49.6" height="49.6" fill="#0b1825" stroke="#0e2035" strokeWidth="0.35"/>
              </pattern>
              <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
                <feMerge>
                  <feMergeNode in="blur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              <filter id="glow-strong" x="-120%" y="-120%" width="340%" height="340%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur"/>
                <feMerge>
                  <feMergeNode in="blur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>

            {/* Background */}
            <rect width="900" height="600" fill="#060c15"/>
            <rect width="900" height="600" fill="url(#cityGrid)" opacity="0.65"/>

            {/* River */}
            <polygon
              points="232,0 240,55 246,115 250,178 253,240 255,295 257,355 260,415 264,475 268,535 272,600 308,600 304,535 300,475 296,415 293,355 291,295 289,240 286,178 282,115 276,55 266,0"
              fill="#06142a"
              opacity="0.85"
            />
            {/* River bank edges */}
            <polyline
              points="232,0 240,55 246,115 250,178 253,240 255,295 257,355 260,415 264,475 268,535 272,600"
              fill="none" stroke="#0d2848" strokeWidth="1.2" opacity="0.5"
            />
            <polyline
              points="266,0 276,55 282,115 286,178 289,240 291,295 293,355 296,415 300,475 304,535 308,600"
              fill="none" stroke="#0d2848" strokeWidth="1.2" opacity="0.5"
            />

            {/* District labels */}
            {showLabels && (
              <>
                <text x="80"  y="46" fill="#0e2035" fontSize={9} fontFamily="JetBrains Mono" letterSpacing="3">WEST</text>
                <text x="360" y="46" fill="#0e2035" fontSize={9} fontFamily="JetBrains Mono" letterSpacing="3">CENTRAL</text>
                <text x="620" y="46" fill="#0e2035" fontSize={9} fontFamily="JetBrains Mono" letterSpacing="3">EAST</text>
              </>
            )}

            {/* ── Edges ── */}
            {EDGES.map(edge => {
              const from = NODES.find(n => n.id === edge.from_node)!
              const to   = NODES.find(n => n.id === edge.to_node)!
              const state = getEdgeState(edge.id)

              const col =
                state === 'failed'   ? '#ef4444' :
                state === 'affected' ? '#f59e0b' :
                state === 'selected' ? '#06b6d4' :
                edge.type === 'bridge' ? '#1d3860' : '#12283e'

              const sw =
                state === 'failed' || state === 'selected' ? 3.5 :
                state === 'affected' ? 2.8 :
                edge.type === 'bridge' ? 2.2 : 1.8

              const dash = edge.type === 'bridge' ? '9 5' : undefined

              return (
                <g key={edge.id} onClick={() => handleSelectEdge(edge)} style={{ cursor: 'pointer' }}>
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth={20}/>
                  {state !== 'normal' && (
                    <line
                      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={col} strokeWidth={sw + 5} strokeDasharray={dash} opacity={0.2}
                    />
                  )}
                  <line
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke={col} strokeWidth={sw}
                    strokeDasharray={dash}
                    strokeLinecap="round"
                    style={{ transition: 'stroke 0.5s, stroke-width 0.3s' }}
                  />
                  {state === 'selected' && (
                    <circle
                      cx={(from.x + to.x) / 2} cy={(from.y + to.y) / 2}
                      r={5} fill="#06b6d4" filter="url(#glow)"
                    />
                  )}
                </g>
              )
            })}

            {/* ── Nodes ── */}
            {NODES.map(node => {
              const state    = getNodeState(node.id)
              const isFailed = state === 'failed'
              const isStrand = state === 'stranded'
              const isSel    = state === 'selected'
              const col      = resolveNodeColor(node.type, isFailed, isStrand, isSel)

              return (
                <g key={node.id} onClick={() => handleSelectNode(node)} style={{ cursor: 'pointer' }}>
                  {/* Selection pulse */}
                  {isSel && (
                    <circle cx={node.x} cy={node.y} r={20} fill="none" stroke="#06b6d4" strokeWidth={1}>
                      <animate attributeName="r" values="15;23;15" dur="2s" repeatCount="indefinite"/>
                      <animate attributeName="opacity" values="0.55;0.1;0.55" dur="2s" repeatCount="indefinite"/>
                    </circle>
                  )}

                  {/* Stranded dashed ring */}
                  {isStrand && (
                    <circle
                      cx={node.x} cy={node.y} r={18}
                      fill="none" stroke="#a855f7" strokeWidth={1.5}
                      strokeDasharray="4 3" opacity={0.7}
                    />
                  )}

                  {/* Glow */}
                  {(isFailed || isSel || isStrand) && (
                    <g filter={isFailed ? 'url(#glow-strong)' : 'url(#glow)'}>
                      <NodeShape node={node} color={col} r={13}/>
                    </g>
                  )}

                  {/* Shape */}
                  <NodeShape node={node} color={col} r={12}/>

                  {/* Label */}
                  {showLabels && (
                    <text
                      x={node.x} y={node.y + 24}
                      textAnchor="middle"
                      fill={isSel ? '#06b6d4' : isFailed ? '#ef4444' : '#1e3a55'}
                      fontSize={8} fontFamily="JetBrains Mono" letterSpacing="1"
                      style={{ transition: 'fill 0.3s' }}
                    >
                      {node.name.replace('Hospital', 'HOSP').replace('Junction', 'JCT')
                               .replace('Logistics', 'LOG').replace('Depot', 'DEPOT')
                               .replace('Bridge', 'BRG').replace('Medical', 'MED')
                               .split(' ').slice(0, 2).join(' ').toUpperCase().slice(0, 14)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>

          {/* ── Map footer controls ── */}
          {!networkLoading && (
            <>
              {/* Legend */}
              <div
                className="absolute bottom-4 left-4 pointer-events-none"
                style={{
                  background: 'rgba(6,12,21,0.90)',
                  border: '1px solid #0d1e30',
                  borderRadius: 6,
                  padding: '10px 13px',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <div className="font-mono mb-2" style={{ fontSize: 8, color: '#1e3550', letterSpacing: '0.2em' }}>LEGEND</div>
                <div className="flex flex-col gap-1.5">
                  {[
                    { col: '#3b82f6', lbl: 'Junction',  shape: 'circle'  },
                    { col: '#8b5cf6', lbl: 'Bridge',    shape: 'diamond' },
                    { col: '#22c55e', lbl: 'Hospital',  shape: 'cross'   },
                    { col: '#f59e0b', lbl: 'Depot',     shape: 'square'  },
                  ].map(item => (
                    <div key={item.lbl} className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 14 14">
                        {item.shape === 'circle'  && <circle cx="7" cy="7" r="4.5" fill={item.col}/>}
                        {item.shape === 'diamond' && <polygon points="7,2 12,7 7,12 2,7" fill={item.col}/>}
                        {item.shape === 'cross'   && (
                          <>
                            <circle cx="7" cy="7" r="5.5" fill={item.col}/>
                            <rect x="4" y="5.8" width="6" height="2.4" fill="white" rx="0.5"/>
                            <rect x="5.8" y="4" width="2.4" height="6" fill="white" rx="0.5"/>
                          </>
                        )}
                        {item.shape === 'square'  && <rect x="2.5" y="2.5" width="9" height="9" fill={item.col} rx="1"/>}
                      </svg>
                      <span className="font-mono" style={{ fontSize: 9, color: '#4a6a8a', letterSpacing: '0.08em' }}>
                        {item.lbl}
                      </span>
                    </div>
                  ))}
                  <div className="pt-1.5" style={{ borderTop: '1px solid #0d1e30', marginTop: 2 }}>
                    {[
                      { col: '#ef4444', lbl: 'Failed'       },
                      { col: '#a855f7', lbl: 'Stranded'     },
                      { col: '#f59e0b', lbl: 'Affected route'},
                      { col: '#06b6d4', lbl: 'Selected'     },
                    ].map(s => (
                      <div key={s.lbl} className="flex items-center gap-2 mt-1.5">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.col }}/>
                        <span className="font-mono" style={{ fontSize: 9, color: '#3a5570', letterSpacing: '0.06em' }}>
                          {s.lbl}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Zoom + labels */}
              <div className="absolute bottom-4 right-4 flex flex-col gap-2">
                <div
                  className="flex flex-col"
                  style={{ background: 'rgba(6,12,21,0.90)', border: '1px solid #0d1e30', borderRadius: 6, overflow: 'hidden' }}
                >
                  <MapBtn onClick={() => handleZoom(1)} label="+" />
                  <div style={{ height: 1, background: '#0d1e30' }}/>
                  <MapBtn onClick={() => handleZoom(-1)} label="−" />
                  <div style={{ height: 1, background: '#0d1e30' }}/>
                  <MapBtn onClick={handleReset} label="⊙" />
                </div>
                <button
                  onClick={() => setShowLabels(v => !v)}
                  className="font-mono transition-colors"
                  style={{
                    background: showLabels ? 'rgba(6,182,212,0.1)' : 'rgba(6,12,21,0.90)',
                    border: `1px solid ${showLabels ? '#0e4a60' : '#0d1e30'}`,
                    borderRadius: 6,
                    padding: '5px 9px',
                    color: showLabels ? '#06b6d4' : '#2a4060',
                    fontSize: 9,
                    letterSpacing: '0.12em',
                    cursor: 'pointer',
                  }}
                >
                  LABELS
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Analysis Panel ── */}
        <div
          className="flex flex-col overflow-y-auto shrink-0"
          style={{ width: 368, background: '#07101e', borderLeft: '1px solid #0d1e30' }}
        >
          <AnalysisPanel
            phase={phase}
            selected={selected}
            simResult={simResult}
            explanation={explanation}
            strandedNodeData={strandedNodeData}
            popImpact={popImpact}
            selectedCriticality={selectedCriticality}
            onSimulate={handleSimulate}
            networkLoading={networkLoading}
          />
        </div>
      </div>
    </div>
  )
}
