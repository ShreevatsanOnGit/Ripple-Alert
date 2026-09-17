export type NodeType = "junction" | "bridge" | "hospital" | "depot"

export type EdgeType = "road" | "bridge"

export interface NetworkNode {
  id: string

  name: string

  lat: number

  lon: number

  type: NodeType

  population_weight: number
}

export interface NetworkEdge {
  id: string

  from_node: string

  to_node: string

  weight: number

  type: EdgeType
}

export interface NetworkResponse {
  nodes: NetworkNode[]

  edges: NetworkEdge[]
}

export interface SimulationResult {
  affected_routes: string[]

  stranded_nodes: string[]

  impact_score: number

  failed_ids?: string[]

  affected_population?: number

  rerouted_population?: number

  primary_failure_population?: number

  service_affected_population?: number

  affected_service_ids?: string[]

  cascade_depth?: number

  impact_breakdown?: {
    stranded_population?: number
    stranded_score?: number
    route_score?: number
    affected_population_score?: number
    service_score?: number
    delay_penalty?: number
    delay_score?: number
    stranded_contribution?: number
    route_contribution?: number
    affected_population_contribution?: number
    facility_score?: number
    facility_contribution?: number
    stranded_weight?: number
    delay_weight?: number
    formula?: string
  }

  propagation?: PropagationStep[]
  score_level?: string
  severity?: string
  status?: string
  service_status?: ServiceStatus[]
  critical_connections?: CriticalConnection[]
  interventions?: Intervention[]
  affected_edges?: string[]
  stranded_edges?: string[]
  degraded_nodes?: string[]
  rerouted_nodes?: string[]
  reassigned_nodes?: string[]
  operational_nodes?: string[]
  broken_routes?: string[]
  unreachable_destinations?: string[]
  directly_affected_nodes?: string[]
  propagation_events?: PropagationEvent[]
}

export interface PropagationEvent {
  type: "edge_affected" | "node_affected" | "stranded_edge" | "stranded_node"
  phase: "affected" | "stranding"
  sequence: number
  edge_id?: string
  node_id?: string
  from_node?: string
  to_node?: string
  incoming_edge_id?: string
  previous_node_id?: string
}

export interface ServiceStatus {
  id: string
  service_id?: string
  name?: string
  type: NodeType
  status: string
  reason?: string
  alternate_routes?: number | null
}

export interface CriticalConnection {
  edge_id: string
  from_node?: string
  to_node?: string
  type?: EdgeType
  criticality_score?: number
  alternate_paths?: number | null
  affected_routes?: number
  affected_services?: string[]
}

export interface Intervention {
  asset_id: string
  action?: string
  expected_affected_route_reduction?: number
  expected_stranded_node_reduction?: number
  expected_impact_reduction?: number
}

export interface PropagationStep {
  node_id: string
  hop_distance: number | null
  status: "rerouted" | "degraded" | "stranded"
  reason: string
  population_weight: number
  affected_population?: number
  stranded_population?: number
  service_impact?: number
  impact_score?: number
  baseline_length?: number | null
  replacement_length?: number | null
  delay?: number | null
  centrality_score?: number
  propagation_priority?: number
}

export interface Explanation {
  narrative: string

  recommendation: string

  evidence?: string[]
}

export interface CriticalityItem {
  node_id: string

  centrality_score: number

  degree?: number

  population_weight?: number

  evidence?: string[]
}

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "http://localhost:8000" : "")
).replace(/\/$/, "")

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,

    headers: {
      Accept: "application/json",

      ...(init?.body ? { "Content-Type": "application/json" } : {}),

      ...init?.headers,
    },
  })

  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`

    try {
      const body = (await response.json()) as { detail?: unknown }

      if (typeof body.detail === "string") {
        detail = body.detail
      } else if (body.detail !== undefined) {
        detail = JSON.stringify(body.detail)
      }
    } catch {
      // Keep the HTTP status when the server does not return JSON.
    }

    throw new Error(detail)
  }

  return response.json() as Promise<T>
}

export const api = {
  getNetwork: () => request<NetworkResponse>("/network", { cache: "no-store" }),

  getCriticality: () =>
    request<CriticalityItem[]>("/criticality", { cache: "no-store" }),

  simulateFailure: (failedIds: string[]) =>
    request<SimulationResult>("/simulate-failure", {
      method: "POST",
      body: JSON.stringify({ failed_ids: failedIds }),
    }),

  explain: (result: SimulationResult, failedIds: string[] = []) =>
    request<Explanation>("/explain", {
      method: "POST",

      body: JSON.stringify({ ...result, failed_ids: failedIds }),
    }),
}

export { API_BASE_URL }
