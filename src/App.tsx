import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"

import {
  Marker,
  MapContainer,
  Polyline,
  ScaleControl,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
  ZoomControl,
} from "react-leaflet"
import MarkerClusterGroup from "react-leaflet-cluster"
import L from "leaflet"

import {
  api,
  type CriticalityItem,
  type Explanation,
  type NetworkEdge,
  type NetworkNode,
  type SimulationResult,
} from "./api"

declare global {
  interface Window {
    pywebview?: {
      api?: {
        save_report?: (
          content: string,
          filename: string,
        ) => Promise<boolean>
      }
    }
  }
}

type Selected = { kind: "node"; data: NetworkNode } | {
  kind: "edge"
  data: NetworkEdge
}

type Phase = "idle" | "selected" | "simulating" | "result"
type AssetFilter = "all" | "junction" | "bridge" | "hospital" | "depot"
type CriticalityFilter = "all" | "important" | "critical" | "top"

function impactLevel(score: number) {
  if (score >= 40) return "CRITICAL"
  if (score >= 20) return "MODERATE"
  return "MINIMAL"
}

function buildJunctionNumberById(nodes: NetworkNode[]) {
  return new Map(
    nodes
      .filter((node) => node.type === "junction")
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node, index) => [node.id, `J-${String(index + 1).padStart(3, "0")}`]),
  )
}

function displayNodeName(node: NetworkNode, junctionNumber?: string) {
  if (node.type === "junction" && junctionNumber) {
    return `Junction ${junctionNumber}`
  }
  if (node.name && node.name !== `Node_${node.id}`) return node.name
  return node.id
}

function coordinateLabel(node: NetworkNode) {
  return `${node.lat.toFixed(5)}, ${node.lon.toFixed(5)}`
}

function osmNodeUrl(node: NetworkNode) {
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(
    node.lat,
  )}&mlon=${encodeURIComponent(node.lon)}#map=19/${encodeURIComponent(
    node.lat,
  )}/${encodeURIComponent(node.lon)}`
}

function normalizedJunctionQuery(value: string) {
  const trimmed = value.trim().toLowerCase()
  const numeric = trimmed.match(/^(?:junction\s*)?(?:j[-\s]*)?(\d{1,3})$/)?.[1]
  return numeric ? `j-${numeric.padStart(3, "0")}` : null
}

const COLORS = {
  junction: "#3b82f6",

  bridge: "#8b5cf6",

  hospital: "#22c55e",

  depot: "#f59e0b",

  failed: "#ef4444",

  stranded: "#a855f7",

  affected: "#f59e0b",

  selected: "#06b6d4",
}

function MapBounds({ nodes }: { nodes: NetworkNode[] }) {
  const map = useMap()

  useEffect(() => {
    if (nodes.length === 0) return

    map.setMaxBounds([
      [
        Math.min(...nodes.map((node) => node.lat)) - 0.015,
        Math.min(...nodes.map((node) => node.lon)) - 0.015,
      ],
      [
        Math.max(...nodes.map((node) => node.lat)) + 0.015,
        Math.max(...nodes.map((node) => node.lon)) + 0.015,
      ],
    ])
    map.fitBounds(
      nodes.map((node) => [node.lat, node.lon]),
      { padding: [32, 32] },
    )
  }, [map, nodes])

  return null
}

function FitNetworkControl({ nodes }: { nodes: NetworkNode[] }) {
  const map = useMap()

  useEffect(() => {
    const control = new L.Control({ position: "bottomright" })
    control.onAdd = () => {
      const container = L.DomUtil.create("div", "leaflet-control ripple-fit-control")
      const button = L.DomUtil.create("button", "ripple-fit-button", container)
      button.type = "button"
      button.title = "Fit map to the Manipal network"
      button.setAttribute("aria-label", "Fit map to the Manipal network")
      button.textContent = "⊙"
      L.DomEvent.disableClickPropagation(container)
      L.DomEvent.on(button, "mousedown", L.DomEvent.stop)
      L.DomEvent.on(button, "touchstart", L.DomEvent.stop)
      L.DomEvent.on(button, "click", () => {
        if (nodes.length > 0) {
          map.fitBounds(
            nodes.map((node) => [node.lat, node.lon]),
            { padding: [32, 32] },
          )
        }
      })
      return container
    }
    control.addTo(map)
    return () => {
      control.remove()
    }
  }, [map, nodes])

  return null
}

function ZoomState({ onZoom }: { onZoom: (zoom: number) => void }) {
  useMapEvents({
    zoomend: (event) => onZoom(event.target.getZoom()),
  })
  return null
}

function FocusSelected({ selected }: { selected: Selected | null }) {
  const map = useMap()
  const previousId = useRef<string | null>(null)

  useEffect(() => {
    if (!selected || selected.kind !== "node") {
      previousId.current = null
      return
    }
    if (previousId.current === selected.data.id) return
    previousId.current = selected.data.id

    const target: [number, number] = [selected.data.lat, selected.data.lon]
    const targetZoom = Math.max(map.getZoom(), 16)
    map.stop()
    if (map.getZoom() >= 16) {
      map.panTo(target, { animate: true, duration: 0.7, easeLinearity: 0.12 })
    } else {
      map.flyTo(target, targetZoom, {
        animate: true,
        duration: 1.35,
        easeLinearity: 0.12,
      })
    }
  }, [map, selected])

  return null
}

function nodeIcon(
  node: NetworkNode,
  state: "normal" | "selected" | "failed" | "stranded" | "affected",
  importance: "normal" | "important" | "critical" = "normal",
) {
  const isServiceNode = node.type === "hospital" || node.type === "depot"
  // Facility markers retain their operational identity. Service impact is
  // communicated by the services panel, not by recoloring the map marker.
  const effectiveState = isServiceNode && state === "affected" ? "normal" : state
  const color =
    effectiveState === "failed"
      ? COLORS.failed
      : effectiveState === "selected"
        ? COLORS.selected
        : effectiveState === "stranded"
          ? COLORS.stranded
          : effectiveState === "affected"
            ? COLORS.affected
            : node.type === "hospital"
              ? "#ef4444"
              : node.type === "depot"
                ? "#22c55e"
              : "#58a6ff"
  const size =
    effectiveState !== "normal"
      ? 16
      : node.type === "hospital"
        ? 22
        : node.type === "depot"
          ? 19
        : node.type !== "junction"
          ? 16
        : importance === "critical"
          ? 13
          : importance === "important"
            ? 10
            : 7
  const shape =
    node.type === "bridge"
      ? "transform:rotate(45deg);border-radius:2px"
      : node.type === "hospital"
        ? "border-radius:4px"
      : node.type === "depot"
        ? "border-radius:2px"
        : "border-radius:50%"
  const symbol =
    node.type === "hospital" ? "+" : node.type === "depot" ? "■" : ""

  return L.divIcon({
    className: `network-marker-icon network-marker-${state}`,
    html: `<span style="display:grid;place-items:center;width:${size}px;height:${size}px;background:${color};border:2px solid ${
      effectiveState === "failed" ||
      effectiveState === "selected" ||
      effectiveState === "stranded"
        ? "#fff"
        : "rgba(255,255,255,.6)"
    };box-shadow:0 0 ${
      state === "normal"
        ? importance === "critical"
          ? 12
          : importance === "important"
            ? 7
            : 3
        : 10
    }px ${color};${shape};color:#0d1117;font:bold ${Math.max(8, size - 3)}px sans-serif;line-height:1">${symbol}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function ClusterIcon(count: number) {
  const size = 30
  return L.divIcon({
    className: "network-cluster-icon",
    html: `<span style="width:${size}px;height:${size}px">${count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

type VisualCascadeEvent = {
  type: "edge" | "node"
  id: string
  phase: "affected" | "stranding"
}

function buildVisualCascadeEvents(
  result: SimulationResult | null,
): VisualCascadeEvent[] {
  if (!result) return []

  const propagationEvents = (
    Array.isArray(result.propagation_events) ? result.propagation_events : []
  ).slice().sort((left, right) => left.sequence - right.sequence)
  const strandingEvents = propagationEvents
    .filter((event) => event.phase === "stranding")
    .flatMap((event) =>
      event.type === "stranded_edge" && event.edge_id
        ? [{ type: "edge" as const, id: event.edge_id, phase: "stranding" as const }]
        : event.type === "stranded_node" && event.node_id
          ? [{ type: "node" as const, id: event.node_id, phase: "stranding" as const }]
          : [],
    )
  const affectedEvents = propagationEvents
    .filter((event) => event.phase === "affected")
    .flatMap((event) =>
      event.type === "edge_affected" && event.edge_id
        ? [{ type: "edge" as const, id: event.edge_id, phase: "affected" as const }]
        : event.type === "node_affected" && event.node_id
          ? [{ type: "node" as const, id: event.node_id, phase: "affected" as const }]
          : [],
    )
  const affectedKeys = new Set(
    affectedEvents.map((event) => `${event.type}:${event.id}`),
  )
  const strandedOnlyEvents = [
    ...strandingEvents.filter((event) => event.type === "edge"),
    ...strandingEvents.filter((event) => event.type === "node"),
  ]
    .map((event) => ({ ...event, phase: "affected" as const }))
    .filter((event) => {
      const key = `${event.type}:${event.id}`
      if (affectedKeys.has(key)) return false
      affectedKeys.add(key)
      return true
    })
  const dedupe = (events: VisualCascadeEvent[]) => {
    const seen = new Set<string>()
    return events.filter((event) => {
      const key = `${event.type}:${event.id}:${event.phase}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  return [
    ...dedupe(affectedEvents),
    ...dedupe(strandedOnlyEvents),
    ...strandingEvents,
  ]
}

function MapView({
  nodes,

  edges,

  selected,

  failedId,

  junctionNumberById,

  result,
  showAfter,
  criticality,
  assetFilter,
  criticalityFilter,
  showLabels,
  tileLayerKey,
  onZoom,
  onTileError,
  onTileLoad,
  onSelectNode,
  onSelectEdge,
  cascadeStage,
  cascadeProgress,
  isCascadePlaying,
}: {
  nodes: NetworkNode[]

  edges: NetworkEdge[]

  selected: Selected | null

  failedId: string | null

  junctionNumberById: Map<string, string>

  result: SimulationResult | null
  showAfter: boolean
  criticality: CriticalityItem[]
  assetFilter: AssetFilter
  criticalityFilter: CriticalityFilter
  showLabels: boolean
  tileLayerKey: number
  onZoom: (zoom: number) => void
  onTileError: () => void
  onTileLoad: () => void

  onSelectNode: (node: NetworkNode) => void

  onSelectEdge: (edge: NetworkEdge) => void
  cascadeStage: number
  cascadeProgress: number
  isCascadePlaying: boolean
}) {
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  )
  const incidentVisible = showAfter && Boolean(result)
  const affectedRouteIds = Array.isArray(result?.affected_routes)
    ? incidentVisible
      ? result.affected_routes
      : []
    : []
  const strandedNodeIds = Array.isArray(result?.stranded_nodes)
    ? incidentVisible
      ? result.stranded_nodes
      : []
    : []
  const failedServiceIdSet = useMemo(
    () =>
      new Set(
        incidentVisible && Array.isArray(result?.failed_ids)
          ? result.failed_ids
          : [],
      ),
    [incidentVisible, result],
  )
  const orderedAffectedRouteIds = useMemo(() => {
    if (!result) return []
    const propagated = (Array.isArray(result.propagation) ? result.propagation : [])
      .filter((step) => step.status === "rerouted")
      .map((step) => step.node_id)
    const propagatedSet = new Set(propagated)
    return [
      ...propagated,
      ...affectedRouteIds.filter((id) => !propagatedSet.has(id)),
    ]
  }, [affectedRouteIds, result])
  const orderedPropagationSteps = useMemo(
    () => (Array.isArray(result?.propagation) ? result.propagation : []),
    [result],
  )
  const orderedStrandedNodeIds = useMemo(
    () => {
      const propagated = orderedPropagationSteps
        .filter((step) => step.status === "stranded")
        .map((step) => step.node_id)
      const propagatedSet = new Set(propagated)
      return [
        ...propagated,
        ...strandedNodeIds.filter(
          (nodeId) => !propagatedSet.has(nodeId),
        ),
      ]
    },
    [orderedPropagationSteps, strandedNodeIds],
  )
  const orderedVisualCascadeEvents = useMemo(
    () => buildVisualCascadeEvents(result),
    [result],
  )
  const affectedEventCount = orderedVisualCascadeEvents.filter(
    (event) => event.phase === "affected",
  ).length
  const strandingEventCount = orderedVisualCascadeEvents.filter(
    (event) => event.phase === "stranding",
  ).length
  const visiblePropagationEventCount = Math.floor(
    orderedVisualCascadeEvents.length * (showAfter ? cascadeProgress : 0),
  )
  const visibleAffectedEventCount = Math.min(
    affectedEventCount,
    visiblePropagationEventCount,
  )
  const visibleStrandingEventCount = Math.max(
    0,
    visiblePropagationEventCount - affectedEventCount,
  )
  const affectedProgress =
    affectedEventCount > 0
      ? visibleAffectedEventCount / affectedEventCount
      : cascadeProgress
  const strandedProgress =
    strandingEventCount > 0
      ? Math.min(1, visibleStrandingEventCount / strandingEventCount)
      : 0
  const visiblePropagationSteps = orderedPropagationSteps.slice(
    0,
    Math.max(0, visiblePropagationEventCount),
  )
  const latestProgressiveStep =
    visiblePropagationSteps.length > 0
      ? visiblePropagationSteps[visiblePropagationSteps.length - 1]
      : null
  const progressiveAffectedPopulation =
    latestProgressiveStep?.affected_population ??
    (result?.affected_population !== undefined
      ? Math.round(result.affected_population * affectedProgress)
      : undefined)
  const progressiveStrandedPopulation =
    latestProgressiveStep?.stranded_population ??
    (result?.impact_breakdown?.stranded_population !== undefined
      ? Math.round(
          result.impact_breakdown.stranded_population * strandedProgress,
        )
      : undefined)
  const progressiveImpactScore =
    latestProgressiveStep?.impact_score ??
    (result ? Math.round(result.impact_score * cascadeProgress * 100) / 100 : 0)

  const displayedResult =
    incidentVisible
      ? {
          ...result,
          affected_routes:
            cascadeProgress > 0
              ? orderedAffectedRouteIds.slice(
                  0,
                  Math.ceil(
                    orderedAffectedRouteIds.length * affectedProgress,
                  ),
                )
              : [],
          stranded_nodes:
            orderedStrandedNodeIds.length > 0
              ? orderedStrandedNodeIds.slice(
                  0,
                  orderedVisualCascadeEvents
                    .slice(0, visiblePropagationEventCount)
                    .filter(
                      (event) =>
                        event.phase === "stranding" &&
                        event.type === "node",
                    ).length,
                )
              : [],
          affected_population:
            progressiveAffectedPopulation,
          impact_score: progressiveImpactScore,
          impact_breakdown: result.impact_breakdown
            ? {
                ...result.impact_breakdown,
                stranded_population: progressiveStrandedPopulation,
              }
            : result.impact_breakdown,
        }
      : null
  // Keep the map's stranded classification authoritative. The displayed
  // result is timeline-gated for metrics, but its sliced node list can have a
  // different order than the backend propagation event stream.
  const affected = new Set(displayedResult?.affected_routes ?? [])
  const affectedEdgeIds = useMemo(
    () =>
      orderedVisualCascadeEvents
        .filter((event) => event.phase === "affected" && event.type === "edge")
        .map((event) => event.id),
    [orderedVisualCascadeEvents],
  )
  const visibleCascadeEventCount = Math.floor(
    orderedVisualCascadeEvents.length * (showAfter ? cascadeProgress : 0),
  )
  const revealedCascadeEdges = useMemo(
    () =>
      new Set(
        orderedVisualCascadeEvents
          .slice(0, visibleCascadeEventCount)
          .filter(
            (event) =>
              event.phase === "affected" && event.type === "edge",
          )
          .map((event) => event.id),
      ),
    [orderedVisualCascadeEvents, visibleCascadeEventCount],
  )
  const revealedCascadeNodes = useMemo(
    () =>
      new Set(
        orderedVisualCascadeEvents
          .slice(0, visibleCascadeEventCount)
          .filter(
            (event) =>
              event.phase === "affected" && event.type === "node",
          )
          .map((event) => event.id),
      ),
    [orderedVisualCascadeEvents, visibleCascadeEventCount],
  )
  const revealedAffectedNodeIds = useMemo(() => {
    return revealedCascadeNodes
  }, [revealedCascadeNodes])
  const isAffectedNodeRevealed = useCallback(
    (nodeId: string) =>
      revealedAffectedNodeIds.has(nodeId),
    [revealedAffectedNodeIds],
  )
  const revealedStrandedEdgeSet = useMemo(
    () =>
      new Set(
        orderedVisualCascadeEvents
          .slice(0, visiblePropagationEventCount)
          .filter(
            (event) =>
              event.phase === "stranding" && event.type === "edge",
          )
          .map((event) => event.id),
      ),
    [orderedVisualCascadeEvents, visiblePropagationEventCount],
  )
  const revealedStrandedNodeIds = useMemo(() => {
    return new Set(
      orderedVisualCascadeEvents
        .slice(0, visiblePropagationEventCount)
        .filter(
          (event) =>
            event.phase === "stranding" && event.type === "node",
        )
        .map((event) => event.id),
    )
  }, [orderedVisualCascadeEvents, visiblePropagationEventCount])
  const isStrandedNodeRevealed = useCallback(
    (nodeId: string) =>
      revealedStrandedNodeIds.has(nodeId),
    [revealedStrandedNodeIds],
  )
  const scoreByNode = useMemo(
    () => new Map(criticality.map((item) => [item.node_id, item.centrality_score])),
    [criticality],
  )
  const sortedScores = useMemo(
    () => criticality.map((item) => item.centrality_score).sort((a, b) => a - b),
    [criticality],
  )
  const importanceFor = useCallback(
    (node: NetworkNode) => {
      const score = scoreByNode.get(node.id)
      if (score === undefined || sortedScores.length === 0) return "normal" as const
      const rank = sortedScores.findIndex((value) => value >= score)
      const percentile = (rank + 1) / sortedScores.length
      return percentile >= 0.9 ? "critical" as const : percentile >= 0.65 ? "important" as const : "normal" as const
    },
    [scoreByNode, sortedScores],
  )
  const visibleNodes = useMemo(
    () =>
      nodes.filter((node) => {
        if (assetFilter !== "all" && node.type !== assetFilter) return false
        const importance = importanceFor(node)
        if (criticalityFilter === "top" && !scoreByNode.has(node.id)) return false
        if (criticalityFilter === "important" && importance === "normal") return false
        if (criticalityFilter === "critical" && importance !== "critical") return false
        return true
      }),
    [assetFilter, criticalityFilter, importanceFor, nodes, scoreByNode],
  )
  const [zoom, setZoom] = useState(13)

  return (
    <MapContainer
      className="h-full w-full"
      center={[13.347, 74.79]}
      zoom={13}
      minZoom={11}
      maxZoom={19}
      scrollWheelZoom
      zoomControl={false}
      markerZoomAnimation={false}
      preferCanvas
      style={{ background: "#0d1117" }}
    >
      <MapBounds nodes={nodes} />
      <FocusSelected selected={selected} />
      <ZoomState
        onZoom={(nextZoom) => {
          setZoom(nextZoom)
          onZoom(nextZoom)
        }}
      />
      <TileLayer
        key={tileLayerKey}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        eventHandlers={{ tileerror: onTileError, tileload: onTileLoad }}
      />
      <ZoomControl position="bottomright" />
      <ScaleControl position="bottomright" imperial={false} />
      <FitNetworkControl nodes={nodes} />
      {edges.map((edge, edgeIndex) => {
        const from = nodeById.get(edge.from_node)

        const to = nodeById.get(edge.to_node)

        if (!from || !to) return null

        const isSelected =
          selected?.kind === "edge" && selected.data.id === edge.id

        const isFailed = failedId === edge.id

        const isAffectedCandidate = affectedEdgeIds.includes(edge.id)
        const isCascadeEdge =
          isAffectedCandidate &&
          revealedCascadeEdges.has(edge.id)
        const isAffected = isCascadeEdge
        const isStrandedPath = revealedStrandedEdgeSet.has(edge.id)
        const isStrandedCascadeEdge =
          isStrandedPath &&
          isCascadePlaying &&
          cascadeProgress < 1

        return (
          <Polyline
            key={edge.id}
            positions={[
              [from.lat, from.lon],

              [to.lat, to.lon],
            ]}
            pathOptions={{
              color: isFailed
                ? COLORS.failed
                : isSelected
                  ? COLORS.selected
                  : isStrandedPath
                    ? COLORS.stranded
                  : isAffected
                    ? COLORS.affected
                    : edge.type === "bridge"
                      ? COLORS.bridge
                      : "#383f47",

              weight:
                isFailed || isSelected || isStrandedPath
                  ? 5
                  : isAffected
                    ? 4
                    : edge.type === "bridge"
                      ? 3
                      : zoom >= 16
                        ? 2
                        : 1,

              opacity:
                isFailed || isSelected || isStrandedPath || isCascadeEdge
                  ? 0.95
                  : zoom >= 16
                    ? 0.55
                    : zoom >= 14
                      ? 0.3
                      : 0.16,

              dashArray: edge.type === "bridge" ? "8 6" : undefined,
              className: isStrandedCascadeEdge
                ? `stranded-cascade-edge cascade-edge-${edgeIndex % 6}`
                : isCascadeEdge && isCascadePlaying && !isStrandedPath
                ? `${cascadeProgress < 1 ? "cascade-edge" : "cascade-edge-final"} cascade-edge-${edgeIndex % 6}`
                : isCascadeEdge && !isStrandedPath
                  ? "cascade-edge-final"
                  : undefined,
              lineCap: "round",
            }}
            eventHandlers={{ click: () => onSelectEdge(edge) }}
          >
            <Tooltip sticky>
              <strong>{edge.id}</strong>
              <br />
              {edge.type} · {edge.from_node} → {edge.to_node}
              <br />
              Weight: {edge.weight}
            </Tooltip>
          </Polyline>
        )
      })}
      <MarkerClusterGroup
        key={`junction-clusters-${
          selected?.kind === "node" ? selected.data.id : "none"
        }-${visibleNodes.map((node) => node.id).join(",")}-${showLabels}`}
        chunkedLoading
        maxClusterRadius={58}
        disableClusteringAtZoom={16}
        showCoverageOnHover={false}
        spiderfyOnMaxZoom
        iconCreateFunction={(cluster: { getChildCount: () => number }) =>
          ClusterIcon(cluster.getChildCount())
        }
      >
        {visibleNodes
          .filter((node) => {
            const isIncident =
              (selected?.kind === "node" && selected.data.id === node.id) ||
              failedId === node.id ||
              isStrandedNodeRevealed(node.id) ||
              isAffectedNodeRevealed(node.id)
            return node.type === "junction" && !isIncident
          })
          .map((node) => (
            <Marker
              key={`${node.id}-cluster`}
              position={[node.lat, node.lon]}
              icon={nodeIcon(node, "normal", importanceFor(node))}
              eventHandlers={{ click: () => onSelectNode(node) }}
            >
              {showLabels && (
                <Tooltip
                  key={`cluster-label-${node.id}`}
                  permanent
                  direction="top"
                  offset={[0, -6]}
                  className="network-label"
                >
                  {displayNodeName(node, junctionNumberById.get(node.id))}
                </Tooltip>
              )}
            </Marker>
          ))}
      </MarkerClusterGroup>
      {visibleNodes
        .filter((node) => {
          const isIncident =
            (selected?.kind === "node" && selected.data.id === node.id) ||
            failedId === node.id ||
            isStrandedNodeRevealed(node.id) ||
            isAffectedNodeRevealed(node.id)
          return node.type !== "junction" || isIncident
        })
        .map((node) => {
          const isSelected =
            selected?.kind === "node" && selected.data.id === node.id

          const isFailed = failedId === node.id

          const isServiceNode = node.type === "hospital" || node.type === "depot"
          // Service facilities stay in the affected lane unless they are
          // explicitly failed. They must not inherit generic node stranding.
          const isStranded = !isServiceNode && isStrandedNodeRevealed(node.id)
          const isAffected = isAffectedNodeRevealed(node.id)
          const isServiceFailed =
            isServiceNode && failedServiceIdSet.has(node.id)

          return (
            <Marker
              key={`${node.id}-asset`}
              position={[node.lat, node.lon]}
              icon={nodeIcon(
                node,
                isFailed
                  || isServiceFailed
                  ? "failed"
                  : isSelected
                    ? "selected"
                    : isStranded
                      ? "stranded"
                      : isAffected
                        ? "affected"
                      : "normal",
                importanceFor(node),
              )}
              eventHandlers={{ click: () => onSelectNode(node) }}
            >
              <Tooltip
                key={`details-${node.id}-${displayNodeName(node, junctionNumberById.get(node.id))}`}
                direction="top"
                offset={[0, -6]}
                className="network-label"
              >
                <strong>
                  {displayNodeName(node, junctionNumberById.get(node.id))}
                </strong>
                <br />
                {node.type} · {node.id}
                <br />
                Location: {coordinateLabel(node)}
                <br />
                Population weight: {node.population_weight}
              </Tooltip>
              {showLabels && (
                <Tooltip
                  key={`label-${node.id}`}
                  permanent
                  direction="top"
                  offset={[0, -6]}
                  className="network-label"
                >
                  {displayNodeName(node, junctionNumberById.get(node.id))}
                </Tooltip>
              )}
            </Marker>
          )
        })}
    </MapContainer>
  )
}

function TypeBadge({ type }: { type: string }) {
  const color =
    type === "MINIMAL"
      ? "#22c55e"
      : type === "MODERATE"
          ? "#f59e0b"
          : type === "HIGH" || type === "CRITICAL"
          ? "#ef4444"
          : COLORS[(type as keyof typeof COLORS)] ?? "#8b949e"

  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-xs uppercase"
      style={{
        color,
        background: `${color}20`,
        border: `1px solid ${color}40`,
        letterSpacing: "0.12em",
      }}
    >
      {type}
    </span>
  )
}

function StatusRow({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span
        className="font-mono text-xs"
        style={{ color: "#8b949e", letterSpacing: "0.1em" }}
      >
        {label}
      </span>
      <span
        className="font-mono text-xs"
        style={{ color, letterSpacing: "0.08em" }}
      >
        {value}
      </span>
    </div>
  )
}

function CriticalitySection({
  criticality,

  nodes,
  result,
  onSelect,
}: {
  criticality: CriticalityItem[]

  nodes: NetworkNode[]

  result: SimulationResult
  onSelect: (node: NetworkNode) => void
}) {
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  )
  const junctionNumberById = useMemo(
    () => buildJunctionNumberById(nodes),
    [nodes],
  )
  const scenarioCriticality = useMemo(() => {
    const propagation = Array.isArray(result.propagation)
      ? result.propagation
      : []
    const byId = new Map(criticality.map((item) => [item.node_id, item]))
    const propagated = propagation
      .slice()
      .sort(
        (left, right) =>
          (right.propagation_priority ?? 0) -
            (left.propagation_priority ?? 0) ||
          (right.centrality_score ?? 0) - (left.centrality_score ?? 0),
      )
      .map((step) => ({
        node_id: step.node_id,
        centrality_score:
          step.centrality_score ?? byId.get(step.node_id)?.centrality_score ?? 0,
      }))
      .filter((item, index, items) =>
        items.findIndex((candidate) => candidate.node_id === item.node_id) === index,
      )
    const propagatedIds = new Set(propagated.map((item) => item.node_id))
    const rankedFallback = criticality
      .slice()
      .sort((left, right) => right.centrality_score - left.centrality_score)
      .filter((item) => !propagatedIds.has(item.node_id))
      .map((item) => ({
        node_id: item.node_id,
        centrality_score: item.centrality_score,
      }))
    return [...propagated, ...rankedFallback]
      .filter((item) => nodeById.has(item.node_id))
      .sort(
        (left, right) =>
          Number(right.centrality_score) - Number(left.centrality_score) ||
          left.node_id.localeCompare(right.node_id),
      )
      .slice(0, 5)
      .sort(
        (left, right) =>
          Number(right.centrality_score) - Number(left.centrality_score) ||
          left.node_id.localeCompare(right.node_id),
      )
  }, [criticality, nodeById, result])

  return (
    <div className="px-5 py-4">
      <div
        className="mb-3 font-mono font-medium"
        style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.22em" }}
      >
        TOP 5 CRITICAL ASSETS IN THIS SCENARIO
      </div>
      {scenarioCriticality.length === 0 && (
        <div className="font-mono text-xs text-[#8b949e]">
          NO SCENARIO PROPAGATION DATA
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {scenarioCriticality.map((item, index) => {
          const node = nodeById.get(item.node_id)

          const color =
            item.centrality_score > 0.75
              ? "#ef4444"
              : item.centrality_score > 0.5
                ? "#f59e0b"
                : "#58a6ff"

          return (
            <button
              type="button"
              key={item.node_id}
              onClick={() => node && onSelect(node)}
              disabled={!node}
              className="flex w-full items-center gap-2.5 rounded p-1.5 -m-1 text-left transition hover:bg-[#21262d]/70 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <div
                className="w-4 shrink-0 text-center font-mono"
                style={{
                  fontSize: 10,
                  color: "#f59e0b",
                }}
              >
                {index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between">
                  <div
                    className="truncate font-mono"
                    style={{ fontSize: 10, color: "#c9d1d9" }}
                  >
                    {node
                      ? displayNodeName(node, junctionNumberById.get(node.id))
                      : item.node_id}
                  </div>
                  <div
                    className="ml-2 shrink-0 font-mono"
                    style={{ fontSize: 10, color: "#f59e0b" }}
                  >
                    {item.centrality_score.toFixed(3)}
                  </div>
                </div>
                <div
                  className="h-1 overflow-hidden rounded-full"
                  style={{ background: "#21262d" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, item.centrality_score * 100))}%`,
                      background: color,
                    }}
                  />
                </div>
              </div>
              {node && <TypeBadge type={node.type} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CompareCol({
  label,
  color,
  rows,
}: {
  label: string
  color: string
  rows: [string, string][]
}) {
  return (
    <div
      className="rounded border border-[#30363d] bg-[#0d1117] p-3"
    >
      <div
        className="mb-2 font-mono"
        style={{ fontSize: 9, color, letterSpacing: "0.15em" }}
      >
        {label}
      </div>
      {rows.map(([key, value]) => (
        <div key={key} className="flex justify-between py-0.5">
          <span className="font-mono" style={{ fontSize: 9, color: "#8b949e" }}>
            {key}
          </span>
          <span
            className="font-mono"
            style={{ fontSize: 10, color: "#c9d1d9" }}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  )
}

function AnalysisPanel({
  phase,

  selected,

  result,

  explanation,

  nodes,

  edges,

  criticality,

  criticalityLoading,

  criticalityError,

  explanationLoading,

  explanationError,

  onSimulate,

  simulationError,
  onSelectNode,
  onGenerateReport,
  cascadeStage,
  cascadeProgress,
  cascadeMinutes,
  isCascadePlaying,
  onToggleCascade,
  onSeekCascade,
  showAfter,
}: {
  phase: Phase

  selected: Selected | null

  result: SimulationResult | null

  explanation: Explanation | null

  nodes: NetworkNode[]

  edges: NetworkEdge[]

  criticality: CriticalityItem[]

  criticalityLoading: boolean

  criticalityError: string | null

  explanationLoading: boolean

  explanationError: string | null

  onSimulate: () => void

  simulationError: string | null
  onSelectNode: (node: NetworkNode) => void
  onGenerateReport: () => void
  cascadeStage: number
  cascadeProgress: number
  cascadeMinutes: number
  isCascadePlaying: boolean
  onToggleCascade: () => void
  onSeekCascade: (delta: number) => void
  showAfter: boolean
}) {
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  )
  const junctionNumberById = useMemo(
    () => buildJunctionNumberById(nodes),
    [nodes],
  )

  const selectedName =
    selected?.kind === "node"
      ? displayNodeName(
          selected.data,
          junctionNumberById.get(selected.data.id),
        )
      : selected
        ? `Route ${selected.data.id.toUpperCase()}`
        : ""

  const selectedType =
    selected?.kind === "node" ? selected.data.type : (selected?.data.type ?? "")

  const readableExplanation = useMemo(() => {
    if (!explanation) return null
    const junctionNumbers = buildJunctionNumberById(nodes)
    const names = nodes
      .slice()
      .sort((left, right) => right.id.length - left.id.length)
      .map((node) => [
        node.id,
        displayNodeName(node, junctionNumbers.get(node.id)),
      ] as const)
    const humanize = (text: string) => {
      let readable = names.reduce(
        (value, [id, name]) => value.split(id).join(name),
        text,
      )
      return readable
        .replace(/\bgraph hop\(s\)?\b/gi, "stages of spread")
        .replace(/\bgraph hop\b/gi, "stage of spread")
        .replace(/\bhop\(s\)?\b/gi, "stages of spread")
        .replace(/\bhop\b/gi, "stage of spread")
        .replace(/\bnode\(s\)?\b/gi, "location(s)")
        .replace(/\bnode\b/gi, "location")
        .replace(/\basset\(s\)?\b/gi, "location(s)")
        .replace(/\basset\b/gi, "location")
        .replace(/\bnetwork location\(s\)\b/gi, "nearby locations")
        .replace(/\bpopulation-weighted units\b/gi, "people")
        .replace(/\bconnected to (\d+) location\(s\)\b/gi, "linked to $1 nearby locations")
    }
    return {
      narrative: humanize(explanation.narrative),
      recommendation: humanize(explanation.recommendation),
    }
  }, [explanation, nodes])

  const stranded = (Array.isArray(result?.stranded_nodes) ? result.stranded_nodes : [])
    .map((id) => nodeById.get(id))
    .filter(Boolean) as NetworkNode[] | undefined
  const orderedVisualCascadeEvents = useMemo(
    () => buildVisualCascadeEvents(result),
    [result],
  )
  const visibleCascadeEvents = showAfter
    ? orderedVisualCascadeEvents.slice(
        0,
        Math.floor(orderedVisualCascadeEvents.length * cascadeProgress),
      )
    : []
  const cascadeProgressEvents = orderedVisualCascadeEvents.slice(
    0,
    Math.floor(orderedVisualCascadeEvents.length * cascadeProgress),
  )
  const visibleAffectedRouteIds = new Set(
    visibleCascadeEvents
      .filter((event) => event.phase === "affected" && event.type === "edge")
      .map((event) => event.id),
  )
  const visibleStrandedRouteIds = new Set(
    visibleCascadeEvents
      .filter((event) => event.phase === "stranding" && event.type === "edge")
      .map((event) => event.id),
  )
  const visibleStrandedNodeIds = new Set(
    visibleCascadeEvents
      .filter((event) => event.phase === "stranding" && event.type === "node")
      .map((event) => event.id),
  )
  const metricAffectedRouteIds = new Set(
    cascadeProgressEvents
      .filter((event) => event.phase === "affected" && event.type === "edge")
      .map((event) => event.id),
  )
  const metricStrandedRouteIds = new Set(
    cascadeProgressEvents
      .filter((event) => event.phase === "stranding" && event.type === "edge")
      .map((event) => event.id),
  )
  const metricStrandedNodeIds = new Set(
    cascadeProgressEvents
      .filter(
        (event) =>
          event.phase === "stranding" &&
          event.type === "node" &&
          result?.stranded_nodes?.includes(event.id),
      )
      .map((event) => event.id),
  )
  const affectedEventCount = orderedVisualCascadeEvents.filter(
    (event) => event.phase === "affected",
  ).length
  const affectedProgress =
    affectedEventCount > 0
      ? cascadeProgressEvents.filter((event) => event.phase === "affected").length /
        affectedEventCount
      : cascadeProgress
  const affectedServiceNodes = useMemo(() => {
    return nodes.filter(
      (node) => node.type === "hospital" || node.type === "depot",
    )
  }, [nodes])
  const revealedAffectedServiceIds = useMemo(() => {
    const ids = new Set<string>()
    const revealedEdgeIds = new Set(
      visibleCascadeEvents
        .filter((event) => event.type === "edge")
        .map((event) => event.id),
    )
    const revealedNodeIds = new Set(
      visibleCascadeEvents
        .filter((event) => event.type === "node")
        .map((event) => event.id),
    )
    for (const edge of edges) {
      if (!revealedEdgeIds.has(edge.id)) continue
      if (affectedServiceNodes.some((node) => node.id === edge.from_node)) {
        ids.add(edge.from_node)
      }
      if (affectedServiceNodes.some((node) => node.id === edge.to_node)) {
        ids.add(edge.to_node)
      }
    }
    for (const node of affectedServiceNodes) {
      if (revealedNodeIds.has(node.id)) ids.add(node.id)
    }
    return ids
  }, [affectedServiceNodes, edges, visibleCascadeEvents])
  const revealedStrandedServiceIds = useMemo(() => {
    const ids = new Set<string>()
    const revealedEdgeIds = new Set(
      visibleCascadeEvents
        .filter(
          (event) => event.phase === "stranding" && event.type === "edge",
        )
        .map((event) => event.id),
    )
    const revealedNodeIds = new Set(
      visibleCascadeEvents
        .filter(
          (event) => event.phase === "stranding" && event.type === "node",
        )
        .map((event) => event.id),
    )
    for (const edge of edges) {
      if (!revealedEdgeIds.has(edge.id)) continue
      if (affectedServiceNodes.some((node) => node.id === edge.from_node)) {
        ids.add(edge.from_node)
      }
      if (affectedServiceNodes.some((node) => node.id === edge.to_node)) {
        ids.add(edge.to_node)
      }
    }
    for (const node of affectedServiceNodes) {
      if (revealedNodeIds.has(node.id)) ids.add(node.id)
    }
    return ids
  }, [affectedServiceNodes, edges, visibleCascadeEvents])

  const propagatedServiceIdSet = useMemo(() => {
    return revealedAffectedServiceIds
  }, [revealedAffectedServiceIds])
  const failedServiceIdSet = useMemo(
    () =>
      new Set(
        (Array.isArray(result?.failed_ids) ? result.failed_ids : []).filter((id) =>
          affectedServiceNodes.some((node) => node.id === id),
        ),
      ),
    [affectedServiceNodes, result],
  )
  const effectiveServiceStatus = (node: NetworkNode) => {
    if (!showAfter || !result) return "operational"
    if (failedServiceIdSet.has(node.id)) return "failed"
    const finalStatus = (
      result.service_status?.find(
        (status) => (status.service_id ?? status.id) === node.id,
      )?.status ?? ""
    ).toLowerCase()
    if (revealedStrandedServiceIds.has(node.id)) {
      if (["stranded", "offline", "unavailable"].includes(finalStatus)) {
        return finalStatus
      }
    }
    if (propagatedServiceIdSet.has(node.id)) return "affected"
    return "operational"
  }
  const getServiceState = (nodeId: string) => {
    const node = affectedServiceNodes.find((candidate) => candidate.id === nodeId)
    const rawStatus = node ? effectiveServiceStatus(node) : "operational"
    const normalized = rawStatus.toLowerCase()
    if (normalized === "failed") return { label: "FAILED", color: "text-red-300" }
    if (normalized === "stranded") return { label: "STRANDED", color: "text-violet-300" }
    if (normalized === "affected") return { label: "AFFECTED", color: "text-amber-300" }
    if (normalized === "offline") return { label: "OFFLINE", color: "text-slate-300" }
    if (normalized === "at_risk") return { label: "AT RISK", color: "text-amber-300" }
    return { label: "ACTIVE", color: "text-emerald-300" }
  }
  const visibleAffectedRouteCount = metricAffectedRouteIds.size
  const visibleStrandedRouteCount = metricStrandedRouteIds.size
  const visibleStrandedNodeCount = metricStrandedNodeIds.size
  const progressiveStep =
    Array.isArray(result?.propagation) && result.propagation.length > 0
      ? result.propagation[
          Math.min(
            result.propagation.length - 1,
            Math.max(0, Math.ceil(result.propagation.length * cascadeProgress) - 1),
          )
        ]
      : undefined
  const visibleImpactScore =
    progressiveStep?.impact_score ??
    (result
      ? Math.round(result.impact_score * cascadeProgress * 100) / 100
      : 0)
  const visibleAffectedPopulation =
    progressiveStep?.affected_population ??
    (result?.affected_population !== undefined
      ? Math.round(result.affected_population * affectedProgress)
      : 0)
  const visibleStranded = stranded?.slice(0, visibleStrandedNodeCount)
  const affectedMajorFacility = affectedServiceNodes.some((node) =>
    cascadeProgressEvents.some(
      (event) => event.type === "node" && event.id === node.id,
    ),
  )
  const failedMajorFacility = affectedServiceNodes.some((node) =>
    failedServiceIdSet.has(node.id),
  )
  const backendFacilityContribution =
    result?.impact_breakdown?.facility_contribution ?? 0
  const backendFacilityScore =
    result?.impact_breakdown?.service_score ??
    result?.impact_breakdown?.facility_score ??
    0
  const calibratedFacilityScore =
    backendFacilityScore > 0
      ? backendFacilityScore
      : failedMajorFacility
        ? 100
        : affectedMajorFacility
          ? 55
          : 0
  const majorFacilityContribution =
    backendFacilityContribution > 0
      ? backendFacilityContribution
      : calibratedFacilityScore * 0.15
  const visiblePreferredServiceDisruption =
    progressiveStep?.service_impact ??
    (result?.service_affected_population !== undefined
      ? Math.round(result.service_affected_population * affectedProgress)
      : 0)
  const visibleRouteContribution =
    result?.impact_breakdown?.route_contribution !== undefined &&
    (result.affected_routes?.length ?? 0) > 0
      ? result.impact_breakdown.route_contribution *
        (visibleAffectedRouteCount / result.affected_routes.length)
      : 0
  const visiblePropagationNodeIds = new Set(
    cascadeProgressEvents
      .filter((event) => event.type === "node")
      .map((event) => event.id),
  )
  const visibleReroutedPopulation = (result?.propagation ?? [])
    .filter(
      (step) =>
        step.status !== "stranded" &&
        visiblePropagationNodeIds.has(step.node_id),
    )
    .reduce((total, step) => total + (step.population_weight ?? 0), 0)
  const visibleStrandedPopulation =
    progressiveStep?.stranded_population ??
    (result?.impact_breakdown?.stranded_population !== undefined
      ? Math.round(
          result.impact_breakdown.stranded_population *
            (result.stranded_nodes?.length
              ? visibleStrandedNodeCount / result.stranded_nodes.length
              : 0),
        )
      : 0)
  const visibleFacilityContribution =
    majorFacilityContribution * cascadeProgress
  const availableServiceNodes = useMemo(() => {
    return affectedServiceNodes.filter((node) => {
      const status = effectiveServiceStatus(node)
      const normalized = status.toLowerCase()
      return !["failed", "stranded", "offline", "at_risk", "affected"].includes(normalized)
    })
  }, [affectedServiceNodes, effectiveServiceStatus])

  const status = result ? impactLevel(result.impact_score) : "OPERATIONAL"

  const selectedCriticality =
    selected?.kind === "node"
      ? criticality.find((item) => item.node_id === selected.data.id)
          ?.centrality_score
      : undefined
  const selectedRank =
    selected?.kind === "node"
      ? criticality.findIndex((item) => item.node_id === selected.data.id) + 1
      : 0
  const selectedCriticalityItem =
    selected?.kind === "node"
      ? criticality.find((item) => item.node_id === selected.data.id)
      : undefined
  const connectedRoutes =
    selected?.kind === "node"
      ? edges.filter(
          (edge) =>
            edge.from_node === selected.data.id || edge.to_node === selected.data.id,
        ).length
      : 0

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-[#30363d] px-5 py-4">
        <div>
          <div
            className="font-display font-semibold text-white"
            style={{ fontSize: 15 }}
          >
            {phase === "result" ? "INCIDENT ANALYSIS" : "NETWORK STATUS"}
          </div>
          <div
            className="mt-0.5 font-mono"
            style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.15em" }}
          >
            {phase === "result"
              ? "FAILURE SIMULATION COMPLETE"
              : "MONITORING ACTIVE"}
          </div>
        </div>
        {result && <TypeBadge type={status} />}
      </div>

      {phase === "idle" && (
        <>
          <div className="border-b border-[#30363d] px-5 py-4">
            <div
              className="mb-3 font-mono font-medium"
              style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.22em" }}
            >
              SYSTEM HEALTH
            </div>
            <StatusRow label="Network" value="OPERATIONAL" color="#22c55e" />
            <StatusRow
              label="Connections"
              value={`${edges.length} active`}
              color="#58a6ff"
            />
            <StatusRow
              label="Nodes"
              value={`${nodes.length} online`}
              color="#22c55e"
            />
          </div>
          <div className="border-b border-[#30363d] px-5 py-4">
            <div
              className="mb-3 font-mono font-medium"
              style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.22em" }}
            >
              STATUS OF SERVICES
            </div>
            <div className="mb-2 font-mono text-[10px] leading-relaxed text-[#8b949e]">
              Current availability before any failure simulation.
            </div>
            <div className="space-y-1.5">
              {affectedServiceNodes.map((node) => (
                <div
                  key={node.id}
                  className="flex items-center justify-between gap-3 font-mono text-[10px]"
                >
                  <span className="truncate text-[#c9d1d9]">
                    {node.name || node.id}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="tracking-widest text-emerald-300">
                      ACTIVE
                    </span>
                    <TypeBadge type={node.type} />
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="border-b border-[#30363d] px-5 py-4">
            <div
              className="mb-2 font-mono font-medium"
              style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.22em" }}
            >
              SELECTED ASSET
            </div>
            <div className="font-mono text-xs text-[#8b949e]">
              None selected
            </div>
          </div>
          <div className="border-b border-[#30363d] px-5 py-4">
            <p className="font-mono text-sm leading-relaxed text-[#8b949e]">
              Select a Manipal infrastructure asset on the map to begin failure
              analysis.
            </p>
          </div>
        </>
      )}

      {phase === "selected" && selected && (
        <>
          <div className="border-b border-[#30363d] px-5 py-4">
            <div
              className="mb-3 font-mono font-medium"
              style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.22em" }}
            >
              SELECTED ASSET
            </div>
            <div className="mb-2 font-display text-base font-semibold text-white">
              {selectedName}
            </div>
            <div className="mb-3 flex items-center gap-2">
              <TypeBadge type={selectedType} />
              {selected.kind === "node" ? (
                <span className="font-mono text-xs text-[#8b949e]">
                  {selected.data.type === "junction"
                    ? junctionNumberById.get(selected.data.id)
                    : "Named facility"}
                </span>
              ) : (
                <span className="font-mono text-xs text-[#8b949e]">
                  {selected.data.id}
                </span>
              )}
            </div>
            {selected.kind === "node" ? (
              <>
                <div className="mb-3 rounded border border-[#30363d] bg-[#0d1117] px-3 py-2">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-[#8b949e]">
                    EXACT LOCATION
                  </div>
                  <div className="mt-1 font-mono text-xs text-[#c9d1d9]">
                    {coordinateLabel(selected.data)}
                  </div>
                  <a
                    href={osmNodeUrl(selected.data)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block font-mono text-[9px] uppercase tracking-widest text-[#58a6ff] hover:text-[#79c0ff]"
                  >
                    Open in OpenStreetMap
                  </a>
                </div>
                <StatusRow label="Status" value="OPERATIONAL" color="#22c55e" />
                <StatusRow
                  label="Population served"
                  value={selected.data.population_weight.toLocaleString()}
                  color="#c9d1d9"
                />
                <StatusRow
                  label="Connected routes"
                  value={String(connectedRoutes)}
                  color="#c9d1d9"
                />
              </>
            ) : (
              <>
                <StatusRow
                  label="Endpoints"
                  value={`${selected.data.from_node} → ${selected.data.to_node}`}
                  color="#c9d1d9"
                />
                <StatusRow
                  label="Weight"
                  value={String(selected.data.weight)}
                  color="#c9d1d9"
                />
              </>
            )}
            {selectedCriticality !== undefined && (
              <>
                <StatusRow
                  label="Centrality"
                  value={selectedCriticality.toFixed(4)}
                  color="#f59e0b"
                />
                <StatusRow
                  label="Criticality rank"
                  value={selectedRank > 0 ? `#${selectedRank}` : "—"}
                  color="#f59e0b"
                />
                <StatusRow
                  label="Algorithm degree"
                  value={String(selectedCriticalityItem?.degree ?? "—")}
                  color="#c9d1d9"
                />
              </>
            )}
          </div>
          <div className="border-b border-[#30363d] px-5 py-4">
            <button
              onClick={onSimulate}
              className="w-full rounded border border-violet-600 bg-violet-700 py-3 font-display text-sm font-bold uppercase tracking-widest text-white shadow-sm transition hover:bg-violet-600 hover:shadow-violet-900/30"
            >
              SIMULATE FAILURE
            </button>
            {simulationError && (
              <div className="mt-2 font-mono text-xs text-red-400">
                {simulationError}
              </div>
            )}
          </div>
        </>
      )}

      {phase === "simulating" && (
        <div className="flex min-h-[240px] flex-1 items-center justify-center px-5">
          <div className="text-center">
            <div className="status-blink font-mono text-sm text-violet-400">
              ANALYZING
            </div>
            <div className="mt-1 font-mono text-xs text-[#8b949e]">
              CASCADE PROPAGATION
            </div>
          </div>
        </div>
      )}

      {phase === "result" && result && selected && (
        <>
          <div className="border-b border-[#30363d] px-5 py-4">
            <div
              className="mb-3 font-mono font-medium"
              style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.22em" }}
            >
              FAILED ASSET
            </div>
            <div className="mb-1.5 font-display text-base font-semibold text-red-300">
              {selectedName}
            </div>
            <div className="flex items-center gap-2">
              <TypeBadge type={selectedType} />
              {selected.kind === "node" && (
                <span className="font-mono text-[10px] text-[#8b949e]">
                  {coordinateLabel(selected.data)}
                </span>
              )}
            </div>
          </div>
          <div className="border-b border-[#30363d] px-5 py-4">
            {result && (
              <div className="rounded border border-[#30363d] bg-[#0d1117] p-3">
                <div className="mb-2 flex items-center justify-between font-mono text-[9px] tracking-widest text-violet-300">
                  <span>LIVE PROPAGATION · SIMULATED TIME</span>
                  <span>
                    T+{Math.floor(cascadeMinutes / 60)}H{" "}
                    {cascadeMinutes % 60}M
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  value={cascadeMinutes}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    onSeekCascade(next - cascadeMinutes)
                  }}
                  className="cascade-timeline-slider"
                  style={{ "--timeline-progress": `${cascadeProgress * 100}%` } as CSSProperties}
                  aria-label="Simulation timeline"
                />
                <div className="font-mono text-[10px] text-slate-400">
                  {cascadeProgress < 0.2
                    ? "Failure detected. Recomputing network paths."
                    : cascadeProgress < 0.55
                      ? "Affected routes are propagating through the network."
                      : cascadeProgress < 0.8
                        ? "Isolation detected. Measuring population impact."
                        : "Impact assessment is converging on the final result."}
                </div>
                <div className="mt-2 flex justify-between font-mono text-[9px] text-slate-600">
                  <span>T+0 MIN</span>
                  <span>T+6 HRS · FINAL</span>
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSeekCascade(-10)}
                    className="cascade-player-button"
                    aria-label="Rewind simulation ten minutes"
                  >
                    −10M
                  </button>
                  <button
                    type="button"
                    onClick={onToggleCascade}
                    className="cascade-player-button cascade-player-primary"
                    aria-label={isCascadePlaying ? "Pause simulation" : "Play simulation"}
                    title={isCascadePlaying ? "Pause simulation" : "Play simulation"}
                    aria-pressed={isCascadePlaying}
                  >
                    <span aria-hidden="true">{isCascadePlaying ? "Ⅱ" : "▶"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSeekCascade(10)}
                    className="cascade-player-button"
                    aria-label="Advance simulation ten minutes"
                  >
                    +10M
                  </button>
                  <span className="ml-auto font-mono text-[9px] text-[#8b949e]">
                    {isCascadePlaying ? "RUNNING" : "PAUSED"}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="border-b border-[#30363d] px-5 py-4">
            <div
              className="mb-3 font-mono font-medium"
              style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.22em" }}
            >
              IMPACT ASSESSMENT
            </div>
            <div className="mb-3 rounded border border-[#30363d] bg-[#0d1117] py-4 text-center">
              <div className="font-mono text-[9px] tracking-widest text-[#8b949e]">
                IMPACT SCORE
              </div>
              <div className="font-display text-4xl font-bold text-red-400">
                {visibleImpactScore.toLocaleString()}
              </div>
              <div className="mt-1 font-mono text-[10px] tracking-[0.2em] text-amber-300">
                IMPACT LEVEL · {impactLevel(visibleImpactScore)}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["ROUTES", visibleAffectedRouteCount, "#f59e0b"],

                ["STRANDED", visibleStrandedNodeCount, "#a855f7"],

                [
                  "PEOPLE AFFECTED",
                  visibleAffectedPopulation,
                  "#ef4444",
                ],
              ].map(([label, value, color]) => (
                <div
                  key={label}
                  className="rounded border border-[#30363d] bg-[#0d1117] p-2 text-center"
                >
                  <div className="font-mono text-[9px] text-[#8b949e]">
                    {label}
                  </div>
                  <div
                    className="font-display text-xl font-bold"
                    style={{ color: String(color) }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
            {result.impact_breakdown && (
              <div className="mt-3 rounded border border-[#30363d] bg-[#0d1117] p-3 font-mono text-[10px] leading-relaxed text-[#8b949e]">
                <div className="mb-2 tracking-widest text-[#58a6ff]">
                  WHY THIS SCORE
                </div>
                <div className="text-[#c9d1d9]">
                  {visibleStrandedNodeCount > 0
                    ? `${visibleStrandedNodeCount} asset(s) lost access to their assigned hospital/depot service.`
                    : "No assets lost access to their assigned hospital/depot service."}{" "}
                  {visibleAffectedRouteCount > 0
                    ? `${visibleAffectedRouteCount} route(s) became slower and require rerouting.`
                    : "No route required rerouting."}
                </div>
                <div className="mt-2">
                  People Rerouted:{" "}
                  <span className="text-amber-300">
                    {visibleReroutedPopulation}
                  </span>{" "}
                  · Preferred Service Disrupted:{" "}
                  <span className="text-cyan-300">
                    {visiblePreferredServiceDisruption}
                  </span>{" "}
                  · People Stranded:{" "}
                  <span className="text-purple-300">
                    {visibleStrandedPopulation}
                  </span>
                </div>
                <div className="mt-2">
                  <span className="text-amber-300">Route impact</span>:{" "}
                  <span className="text-[#c9d1d9]">
                    {visibleRouteContribution.toFixed(2)} pts
                  </span>{" "}
                  ·{" "}
                  <span className="text-cyan-300">Major facility</span>:{" "}
                  {failedMajorFacility
                    ? "FAILED"
                    : affectedMajorFacility
                      ? "AFFECTED"
                      : "NONE"}{" "}
                  →{" "}
                  <span className="text-[#c9d1d9]">
                    {visibleFacilityContribution.toFixed(2)} pts
                  </span>
                </div>
              </div>
            )}
            {visibleStranded && visibleStranded.length > 0 && (
              <div className="mt-3 rounded border border-[#30363d] bg-[#0d1117] p-3">
                <div className="mb-2 font-mono text-[9px] tracking-widest text-[#8b949e]">
                  STRANDED NODES
                </div>
                <div className="mb-2 font-mono text-[10px] leading-relaxed text-[#8b949e]">
                  These nodes no longer have a viable hospital or depot route.
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {visibleStranded.map((node) => (
                    <span
                      key={node.id}
                      className="rounded border border-purple-800/80 bg-purple-950/60 px-2 py-0.5 font-mono text-xs text-purple-300"
                    >
                      {displayNodeName(node, junctionNumberById.get(node.id))}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="border-b border-[#30363d] px-5 py-4">
            <div className="rounded border border-[#30363d] bg-[#0d1117] p-3">
              <div className="mb-3 font-mono text-[9px] tracking-widest text-[#8b949e]">
                WHY THIS MATTERS
              </div>
              {explanationLoading && (
                <div className="status-blink font-mono text-xs text-violet-400">
                  GENERATING ANALYSIS...
                </div>
              )}
              {explanationError && (
                <div className="font-mono text-xs text-red-400">
                  {explanationError}
                </div>
              )}
              {readableExplanation && (
                <p className="incident-copy incident-copy-narrative">
                  {readableExplanation.narrative}
                </p>
              )}
            </div>
          </div>
          <div className="border-b border-[#30363d] px-5 py-4">
            <div className="rounded border border-[#30363d] bg-[#0d1117] p-3">
              <div className="mb-3 font-mono text-[9px] tracking-widest text-[#8b949e]">
                RECOMMENDED ACTION
              </div>
              {readableExplanation && (
                <p className="incident-copy incident-copy-recommendation">
                  {readableExplanation.recommendation}
                </p>
              )}
              {explanationError && (
                <div className="font-mono text-xs text-[#8b949e]">
                  RECOMMENDATION UNAVAILABLE
                </div>
              )}
            </div>
          </div>
          <div className="border-b border-[#30363d] px-5 py-4">
            <div className="mb-2 font-mono text-[9px] tracking-widest text-[#8b949e]">
              STATUS OF SERVICES
            </div>
            <div className="mb-2 font-mono text-[10px] leading-relaxed text-[#8b949e]">
              Facility status for this scenario. Hospital and depot services
              are tracked separately.
            </div>
            <div className="mb-3 rounded border border-emerald-900/70 bg-emerald-950/20 px-2.5 py-2 font-mono text-[10px] leading-relaxed">
              <span className="tracking-widest text-emerald-300">
                SERVICES AVAILABLE NOW
              </span>
              <div className="mt-1 text-[#c9d1d9]">
                {availableServiceNodes.length > 0
                  ? availableServiceNodes
                      .map((node) => node.name || node.id)
                      .join(" · ")
                  : "No hospital or depot service remains available."}
              </div>
            </div>
            {affectedServiceNodes.length > 0 ? (
              <div className="space-y-1.5">
                {affectedServiceNodes.map((node) => {
                  const serviceState = getServiceState(node.id)
                  return (
                    <div
                      key={node.id}
                      className="flex items-center justify-between gap-3 font-mono text-[10px]"
                    >
                      <span className="truncate text-[#c9d1d9]">
                        {node.name || node.id}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className={`font-mono text-[9px] tracking-widest ${serviceState.color}`}>
                          {serviceState.label}
                        </span>
                        <TypeBadge type={node.type} />
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="font-mono text-[10px] leading-relaxed text-[#8b949e]">
                No hospital or depot node is included in the returned affected
                or stranded set.
              </div>
            )}
          </div>
          <CriticalitySection
            criticality={criticality}
            nodes={nodes}
            result={result}
            onSelect={onSelectNode}
          />
          <div className="-mx-5 h-px bg-[#30363d]" aria-hidden="true" />
          <div className="border-b border-[#30363d] px-5 py-4">
            <div className="mb-3 font-mono text-[9px] tracking-widest text-[#8b949e]">
              REPORT GENERATION
            </div>
            <button
              type="button"
              onClick={onGenerateReport}
              className="w-full rounded border border-[#30363d] bg-[#21262d] py-2.5 font-mono text-[10px] tracking-widest text-[#58a6ff] transition hover:border-[#58a6ff]/50 hover:bg-[#30363d] hover:text-[#79c0ff]"
            >
              GENERATE INCIDENT REPORT
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function App() {
  const [nodes, setNodes] = useState<NetworkNode[]>([])

  const [edges, setEdges] = useState<NetworkEdge[]>([])

  const [criticality, setCriticality] = useState<CriticalityItem[]>([])

  const [selected, setSelected] = useState<Selected | null>(null)

  const [phase, setPhase] = useState<Phase>("idle")

  const [result, setResult] = useState<SimulationResult | null>(null)
  const [simulatedFailureId, setSimulatedFailureId] = useState<string | null>(null)

  const [explanation, setExplanation] = useState<Explanation | null>(null)

  const [networkLoading, setNetworkLoading] = useState(true)

  const [networkError, setNetworkError] = useState<string | null>(null)

  const [criticalityLoading, setCriticalityLoading] = useState(true)

  const [criticalityError, setCriticalityError] = useState<string | null>(null)

  const [explanationLoading, setExplanationLoading] = useState(false)

  const [explanationError, setExplanationError] = useState<string | null>(null)

  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(false)
  const [mapZoom, setMapZoom] = useState(13)
  const [tileError, setTileError] = useState(false)
  const [tileErrorVisible, setTileErrorVisible] = useState(false)
  const [tileLayerKey, setTileLayerKey] = useState(0)
  const [search, setSearch] = useState("")
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all")
  const [criticalityFilter, setCriticalityFilter] =
    useState<CriticalityFilter>("all")
  const [showAfter, setShowAfter] = useState(true)
  const [cascadeStage, setCascadeStage] = useState(0)
  const [cascadeMinutes, setCascadeMinutes] = useState(0)
  const [isCascadePlaying, setIsCascadePlaying] = useState(false)
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  )
  const junctionNumberById = useMemo(
    () => buildJunctionNumberById(nodes),
    [nodes],
  )

  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      void fetch("/__ripple/heartbeat", {
        method: "POST",
        cache: "no-store",
      }).catch(() => undefined)
    }, 2000)

    return () => window.clearInterval(heartbeat)
  }, [])

  useEffect(() => {
    if (tileError) {
      setTileErrorVisible(true)
      return
    }

    const fadeOut = window.setTimeout(() => setTileErrorVisible(false), 500)
    return () => window.clearTimeout(fadeOut)
  }, [tileError])

  useEffect(() => {
    const recoverTiles = () => {
      setTileError(false)
      setTileLayerKey((current) => current + 1)
    }
    const handleOffline = () => setTileError(true)

    window.addEventListener("online", recoverTiles)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", recoverTiles)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!tileError) return

    const retry = window.setInterval(() => {
      if (navigator.onLine) {
        setTileLayerKey((current) => current + 1)
      }
    }, 5000)

    return () => window.clearInterval(retry)
  }, [tileError])

  useEffect(() => {
    if (phase !== "result" || !result) {
      setCascadeStage(0)
      setCascadeMinutes(0)
      setIsCascadePlaying(false)
      return
    }

    if (!isCascadePlaying) return

    const progressTimer = window.setInterval(() => {
      setCascadeMinutes((current) => {
        const next = Math.min(360, current + 1)
        setCascadeStage(next >= 270 ? 4 : next >= 198 ? 3 : next >= 72 ? 2 : 1)
        if (next >= 360) setIsCascadePlaying(false)
        return next
      })
    }, 40)

    return () => {
      window.clearInterval(progressTimer)
    }
  }, [phase, result, isCascadePlaying])

  useEffect(() => {
    let active = true

    api
      .getNetwork()
      .then((data) => {
        if (!active) return

        setNodes(data.nodes)

        setEdges(data.edges)

        setNetworkError(null)
      })
      .catch((error: Error) => active && setNetworkError(error.message))
      .finally(() => active && setNetworkLoading(false))

    api
      .getCriticality()
      .then((data) => active && setCriticality(data))
      .catch((error: Error) => active && setCriticalityError(error.message))
      .finally(() => active && setCriticalityLoading(false))

    return () => {
      active = false
    }
  }, [])

  const selectNode = useCallback(
    (node: NetworkNode) => {
      if (phase === "simulating") return

      const canonicalNode = nodeById.get(node.id) ?? node
      setSelected({ kind: "node", data: canonicalNode })

      if (phase === "result" && result) {
        return
      }

      setPhase("selected")

      setResult(null)

      setExplanation(null)

      setSimulationError(null)

      setExplanationError(null)
      setShowAfter(false)
      setCascadeStage(0)
      setCascadeMinutes(0)
      setIsCascadePlaying(false)
    },
    [nodeById, phase, result],
  )

  const selectEdge = useCallback(
    (edge: NetworkEdge) => {
      if (phase === "simulating") return

      setSelected({ kind: "edge", data: edge })

      if (phase === "result" && result) {
        return
      }

      setPhase("selected")

      setResult(null)

      setExplanation(null)

      setSimulationError(null)

      setExplanationError(null)
      setShowAfter(false)
      setCascadeStage(0)
      setCascadeMinutes(0)
      setIsCascadePlaying(false)
    },
    [phase, result],
  )

  const simulate = useCallback(async () => {
    if (!selected || phase !== "selected" || result) return

    setPhase("simulating")

    setSimulationError(null)

    setExplanationError(null)
    setShowAfter(true)

    try {
      const simulation = await api.simulateFailure([selected.data.id])

      setResult(simulation)
      setSimulatedFailureId(selected.data.id)

      setPhase("result")
      setCascadeMinutes(0)
      setCascadeStage(1)
      setIsCascadePlaying(true)

      setExplanationLoading(true)

      try {
        setExplanation(await api.explain(simulation, [selected.data.id]))
      } catch (error) {
        setExplanationError(
          error instanceof Error ? error.message : "Explanation unavailable",
        )
      } finally {
        setExplanationLoading(false)
      }
    } catch (error) {
      setSimulationError(
        error instanceof Error ? error.message : "Simulation failed",
      )

      setPhase("selected")
    }
  }, [phase, result, selected])

  const reset = useCallback(() => {
    setPhase("idle")

    setSelected(null)

    setResult(null)
    setSimulatedFailureId(null)

    setExplanation(null)

    setSimulationError(null)

    setExplanationError(null)
    setSearch("")
    setAssetFilter("all")
    setCriticalityFilter("all")
    setShowAfter(true)
    setCascadeStage(0)
    setCascadeStage(0)
    setCascadeMinutes(0)
    setIsCascadePlaying(false)
  }, [])

  const toggleCascade = useCallback(() => {
    if (!result) return
    if (cascadeMinutes >= 360) {
      setCascadeMinutes(0)
      setCascadeStage(1)
      setIsCascadePlaying(true)
      return
    }
    setIsCascadePlaying((playing) => !playing)
  }, [cascadeMinutes, result])

  const seekCascade = useCallback(
    (delta: number) => {
      if (!result) return
      setCascadeMinutes((current) => {
        const next = Math.max(0, Math.min(360, current + delta))
        setCascadeStage(next >= 270 ? 4 : next >= 198 ? 3 : next >= 72 ? 2 : 1)
        return next
      })
    },
    [result],
  )

  const failedId =
    showAfter && phase === "result" ? simulatedFailureId : null
  const cascadeProgress =
    phase === "result" ? Math.min(1, cascadeMinutes / 360) : 0
  const visibleNodes = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return nodes
    const junctionNumbers = buildJunctionNumberById(nodes)
    return nodes.filter(
      (node) =>
        node.id.toLowerCase().includes(query) ||
        node.name.toLowerCase().includes(query) ||
        displayNodeName(node, junctionNumbers.get(node.id))
          .toLowerCase()
          .includes(query) ||
        (junctionNumbers.get(node.id) ?? "").toLowerCase().includes(query),
    )
  }, [nodes, search])
  const searchMatches = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []
    const junctionNumbers = buildJunctionNumberById(nodes)
    return nodes
      .filter(
        (node) =>
          node.id.toLowerCase().includes(query) ||
          node.name.toLowerCase().includes(query) ||
          displayNodeName(node, junctionNumbers.get(node.id))
            .toLowerCase()
            .includes(query) ||
          (junctionNumbers.get(node.id) ?? "").toLowerCase().includes(query),
      )
      .sort((left, right) => {
        const leftNumber = junctionNumbers.get(left.id)?.toLowerCase()
        const rightNumber = junctionNumbers.get(right.id)?.toLowerCase()
        const normalized = normalizedJunctionQuery(query)
        const leftExact =
          leftNumber === normalized || leftNumber === query ? 0 : 1
        const rightExact =
          rightNumber === normalized || rightNumber === query ? 0 : 1
        return leftExact - rightExact
      })
      .slice(0, 8)
  }, [nodes, search])

  const affectedAreaSummary = useMemo(() => {
    if (!result) return []
    const affectedEdgeIds = new Set(
      Array.isArray(result.affected_routes) ? result.affected_routes : [],
    )
    const impactedNodes = new Map<string, NetworkNode>()
    for (const step of result.propagation ?? []) {
      const node = nodes.find((item) => item.id === step.node_id)
      if (node) impactedNodes.set(node.id, node)
    }
    for (const edge of edges) {
      if (!affectedEdgeIds.has(edge.id)) continue
      const from = nodes.find((node) => node.id === edge.from_node)
      const to = nodes.find((node) => node.id === edge.to_node)
      if (from) impactedNodes.set(from.id, from)
      if (to) impactedNodes.set(to.id, to)
    }
    for (const id of Array.isArray(result.stranded_nodes) ? result.stranded_nodes : []) {
      const node = nodes.find((item) => item.id === id)
      if (node) impactedNodes.set(node.id, node)
    }
    return Array.from(impactedNodes.values())
      .sort((left, right) => right.population_weight - left.population_weight)
      .slice(0, 12)
  }, [edges, nodes, result])

  const affectedServices = useMemo(() => {
    if (!result) return []
    const affectedRouteIds = new Set(
      Array.isArray(result.affected_routes) ? result.affected_routes : [],
    )
    const affectedNodeIds = new Set(
      Array.isArray(result.stranded_nodes) ? result.stranded_nodes : [],
    )
    for (const edge of edges) {
      if (!affectedRouteIds.has(edge.id)) continue
      affectedNodeIds.add(edge.from_node)
      affectedNodeIds.add(edge.to_node)
    }
    return nodes.filter(
      (node) =>
        affectedNodeIds.has(node.id) &&
        (node.type === "hospital" || node.type === "depot"),
    )
  }, [edges, nodes, result])

  const generateReport = useCallback(() => {
    if (!result || !selected) return
    const failedAsset =
      selected.kind === "node"
        ? displayNodeName(
            selected.data,
            buildJunctionNumberById(nodes).get(selected.data.id),
          )
        : `Route ${selected.data.id.toUpperCase()}`
    const reportNodeById = new Map(nodes.map((node) => [node.id, node]))
    const reportJunctionNumbers = buildJunctionNumberById(nodes)
    const reportAvailableServiceNodes = nodes.filter(
      (node) =>
        (node.type === "hospital" || node.type === "depot") &&
        !(result.failed_ids ?? []).includes(node.id),
    )
    const humanizeReportText = (text: string) =>
      nodes
        .slice()
        .sort((left, right) => right.id.length - left.id.length)
        .reduce(
          (value, node) =>
            value.split(node.id).join(
              node.name || displayNodeName(node, reportJunctionNumbers.get(node.id)),
            ),
          text,
        )
    const propagation = result.propagation ?? []
    const propagationByPriority = propagation
      .slice()
      .sort(
        (left, right) =>
          (right.propagation_priority ?? 0) -
            (left.propagation_priority ?? 0) ||
          (right.centrality_score ?? 0) - (left.centrality_score ?? 0),
      )
    const topScenarioAssets = propagationByPriority
      .map((step) => reportNodeById.get(step.node_id))
      .filter((node): node is NetworkNode => Boolean(node))
      .filter(
        (node, index, assets) =>
          assets.findIndex((candidate) => candidate.id === node.id) === index,
      )
      .slice(0, 5)
    const reroutedCount = propagation.filter(
      (step) => step.status !== "stranded",
    ).length
    const strandedCount = result.stranded_nodes.length
    const proximityStrandedNames = propagation
      .filter(
        (step) =>
          step.status === "stranded" &&
          step.reason.toLowerCase().includes("adjacent network area"),
      )
      .map((step) => {
        const node = reportNodeById.get(step.node_id)
        return node
          ? displayNodeName(node, reportJunctionNumbers.get(node.id))
          : step.node_id
      })
    const sixHourStatus =
      strandedCount > 0
        ? `After six hours without intervention, ${strandedCount} asset(s) remain without a viable hospital or depot route and ${reroutedCount} other asset(s) are operating through slower or altered routes.`
        : `After six hours without intervention, ${reroutedCount} asset(s) are operating through slower or altered routes, but no asset is currently without a viable hospital or depot route.`
    const scoreBreakdown = result.impact_breakdown
    const reportServiceNodes = nodes.filter(
      (node) => node.type === "hospital" || node.type === "depot",
    )
    const failedServiceNames = reportServiceNodes
      .filter((node) => (result.failed_ids ?? []).includes(node.id))
      .map((node) => node.name || displayNodeName(node, reportJunctionNumbers.get(node.id)))
    const serviceStatusLines = reportServiceNodes.map((node) => {
      const failed = (result.failed_ids ?? []).includes(node.id)
      return `- ${node.name || displayNodeName(node, reportJunctionNumbers.get(node.id))}: ${failed ? "FAILED" : "ACTIVE"}`
    })
    const report = [
      "RIPPLE ALERT — INCIDENT ANALYSIS REPORT",
      `Generated: ${new Date().toISOString()}`,
      "",
      "1. INCIDENT ANALYSIS",
      `This report describes the simulated Manipal network incident initiated at ${failedAsset}.`,
      `The scenario is classified as ${impactLevel(result.impact_score)} with an impact score of ${result.impact_score.toFixed(2)} out of 100.`,
      "",
      "2. FAILED ASSET",
      `Primary failed asset: ${failedAsset}`,
      `Asset role: ${selected.kind === "node" ? selected.data.type : "network route"}`,
      "",
      "3. SIX-HOUR SITUATION RESULT",
      sixHourStatus,
      `The simulation reached ${result.cascade_depth ?? "the recorded"} graph hop(s) of propagation from the failed asset.`,
      "",
      "4. IMPACT ASSESSMENT",
      `Affected routes: ${result.affected_routes.length}`,
      `Stranded assets: ${strandedCount}`,
      `Population-weighted units affected: ${result.affected_population ?? 0}`,
      `Population-weighted units stranded: ${scoreBreakdown?.stranded_population ?? 0}`,
      `Preferred service disruption: ${result.service_affected_population ?? 0}`,
      `Overall severity: ${impactLevel(result.impact_score)}`,
      ...(proximityStrandedNames.length > 0
        ? [
            `Immediate facility-surrounding isolation: ${proximityStrandedNames.join(", ")}.`,
            "These directly adjacent nodes and their connecting paths were stranded as the local consequence of the failed hospital/depot.",
          ]
        : []),
      "",
      "5. WHY THIS SCORE",
      `The score is ${result.impact_score.toFixed(2)} because the scenario combines the visible loss of access at ${strandedCount} asset(s), ${result.affected_population ?? 0} population-weighted unit(s) affected, and ${result.affected_routes.length} rerouted route(s).`,
      `Score contributions: stranded assets ${(scoreBreakdown?.stranded_contribution ?? 0).toFixed(2)} points; affected population ${(scoreBreakdown?.affected_population_contribution ?? 0).toFixed(2)} points; rerouted routes ${(scoreBreakdown?.route_contribution ?? 0).toFixed(2)} points; major facility failure ${(scoreBreakdown?.facility_contribution ?? 0).toFixed(2)} points.`,
      "",
      "6. STRANDED NODES",
      ...(result.stranded_nodes.length > 0
        ? result.stranded_nodes.map((id) => {
            const node = reportNodeById.get(id)
            return `- ${node ? displayNodeName(node, reportJunctionNumbers.get(node.id)) : "Unresolved network asset"}`
          })
        : ["- No stranded nodes were recorded."]),
      "",
      "7. TOP 5 CRITICAL ASSETS IN THIS SCENARIO",
      ...(topScenarioAssets.length > 0
        ? topScenarioAssets.map(
            (node, index) =>
              `${index + 1}. ${displayNodeName(node, reportJunctionNumbers.get(node.id))}`,
          )
        : ["- No scenario propagation records were returned."]),
      "",
      "8. WHY THIS MATTERS",
      humanizeReportText(
        explanation?.narrative ??
          "The incident reduces reliable access across the infrastructure network and requires operational response.",
      ),
      "",
      "9. RECOMMENDED ACTION",
      humanizeReportText(
        explanation?.recommendation ?? "No recommendation was returned.",
      ),
      "",
      "10. STATUS OF SERVICES",
      ...(serviceStatusLines.length > 0
        ? serviceStatusLines
        : ["- No hospital or depot services were returned."]),
      `Services available after the simulated failure: ${reportAvailableServiceNodes.length > 0 ? reportAvailableServiceNodes.map((node) => node.name || displayNodeName(node, reportJunctionNumbers.get(node.id))).join(", ") : "none"}.`,
      failedServiceNames.length > 0
        ? `Failed services: ${failedServiceNames.join(", ")}.`
        : "No hospital or depot service was directly failed.",
    ].join("\n")
    const filename = `ripple-alert-incident-${new Date().toISOString().slice(0, 10)}.txt`
    const saveReport = window.pywebview?.api?.save_report
    if (saveReport) {
      void saveReport(report, filename).catch(() => undefined)
      return
    }

    const blob = new Blob([report], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }, [
    affectedAreaSummary,
    edges.length,
    explanation,
    nodes.length,
    result,
    selected,
  ])

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#0d1117] text-[#c9d1d9]">
      <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-[#30363d] bg-[#161b22] px-5">
        <div className="app-header-brand border-r border-[#30363d] pr-5 text-lg font-bold tracking-[0.12em] text-white">
          RIPPLE ALERT
        </div>
        <div className="flex items-center gap-2 border-r border-[#30363d] pr-5">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              networkLoading
                ? "status-blink bg-amber-400"
                : networkError
                  ? "bg-red-500"
                  : "bg-emerald-400"
            }`}
          />
          <span
            className="font-mono text-xs font-medium"
            style={{
              color: networkLoading
                ? "#f59e0b"
                : networkError
                  ? "#ef4444"
                  : "#22c55e",
            }}
          >
            {networkLoading
              ? "INITIALIZING"
              : networkError
                ? "NETWORK ERROR"
                : "Operational"}
          </span>
        </div>
        {!networkLoading && !networkError && (
          <div className="flex items-center gap-2 font-mono text-xs text-[#8b949e]">
            <span>Manipal, Karnataka</span>
            <span className="text-[#484f58]">·</span>
            <span className="font-mono text-[10px] text-[#c9d1d9]">
              {nodes.length} nodes · {edges.length} connections
            </span>
          </div>
        )}
        <div className="flex-1" />
        {!networkLoading && !networkError && (
          <div className="hidden items-center gap-1.5 md:flex">
            <div className="relative">
              <input
                value={search}
                onChange={(event) => {
                  const nextSearch = event.target.value
                  setSearch(nextSearch)
                  if (nextSearch.trim()) {
                    setSelected(null)
                  }
                  const query = nextSearch.trim().toLowerCase()
                  if (!query) return

                  const junctionNumbers = buildJunctionNumberById(nodes)
                  const normalizedJunction = normalizedJunctionQuery(query)
                  const exactMatch = nodes.find((node) => {
                    const junctionNumber = junctionNumbers.get(node.id)
                    const labels = [
                      node.id,
                      node.name,
                      displayNodeName(node, junctionNumber),
                      junctionNumber,
                      junctionNumber ? `junction ${junctionNumber}` : "",
                    ]
                    return labels.some(
                      (label) => (label ?? "").toLowerCase() === query,
                    ) || junctionNumber?.toLowerCase() === normalizedJunction
                  })
                  if (exactMatch)                   selectNode(nodeById.get(exactMatch.id) ?? exactMatch)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && searchMatches[0]) {
                    selectNode(nodeById.get(searchMatches[0].id) ?? searchMatches[0])
                    setSearch(
                      displayNodeName(
                        searchMatches[0],
                        buildJunctionNumberById(nodes).get(searchMatches[0].id),
                      ),
                    )
                  }
                }}
                placeholder="Search assets..."
                aria-label="Search assets"
                className="w-44 rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-[#c9d1d9] outline-none placeholder:text-[#6e7681] transition hover:border-[#484f58] focus:border-[#58a6ff]"
              />
              {search.trim() && searchMatches.length > 0 && (
                <div className="absolute right-0 top-full z-[1200] mt-1 w-64 rounded border border-[#30363d] bg-[#161b22] p-1 shadow-xl">
                  {searchMatches.map((node) => {
                    const junctionNumber = buildJunctionNumberById(nodes).get(node.id)
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => {
                          selectNode(nodeById.get(node.id) ?? node)
                          setSearch(displayNodeName(node, junctionNumber))
                        }}
                        className="block w-full rounded px-2 py-1.5 text-left font-mono text-[10px] text-[#c9d1d9] hover:bg-[#21262d]"
                      >
                        <span className="block truncate">
                          {displayNodeName(node, junctionNumber)}
                        </span>
                        <span className="block truncate text-[9px] text-[#8b949e]">
                          {node.type} · {junctionNumber ?? node.id} · {coordinateLabel(node)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <select
              value={assetFilter}
              onChange={(event) => setAssetFilter(event.target.value as AssetFilter)}
              aria-label="Filter asset type"
              className="rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-[#8b949e] outline-none transition hover:border-[#484f58] focus:border-[#58a6ff]"
            >
              <option value="all">ALL TYPES</option>
              <option value="junction">JUNCTIONS</option>
              {nodes.some((node) => node.type === "bridge") && (
                <option value="bridge">BRIDGES</option>
              )}
              <option value="hospital">HOSPITALS</option>
              <option value="depot">DEPOTS</option>
            </select>
            <select
              value={criticalityFilter}
              onChange={(event) =>
                setCriticalityFilter(event.target.value as CriticalityFilter)
              }
              aria-label="Filter criticality"
              className="rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-[#8b949e] outline-none transition hover:border-[#484f58] focus:border-[#58a6ff]"
            >
              <option value="all">ALL IMPORTANCE</option>
              <option value="important">IMPORTANT+</option>
              <option value="critical">CRITICAL</option>
              <option value="top">TOP RANKED</option>
            </select>
          </div>
        )}
        {phase === "simulating" && (
          <span className="status-blink font-mono text-xs text-violet-400">
            ANALYZING NETWORK
          </span>
        )}
        {(phase === "selected" || phase === "result") && (
          <button
            onClick={reset}
            className="rounded border border-[#30363d] bg-transparent px-3 py-1.5 font-mono text-xs text-[#8b949e] transition hover:border-[#484f58] hover:bg-[#21262d] hover:text-[#c9d1d9]"
          >
            RESET BASELINE
          </button>
        )}
      </header>

      <div className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col lg:flex-row">
        <main className="relative min-h-[52vh] min-w-0 max-w-full flex-1 overflow-hidden border-b border-[#30363d] lg:min-h-0 lg:border-b-0">
          {networkLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d1117]">
              <div className="status-blink text-center font-mono text-sm tracking-[0.24em] text-cyan-400">
                LOADING MANIPAL NETWORK
              </div>
            </div>
          )}
          {networkError && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-[600] -translate-x-1/2 rounded border border-red-900/70 bg-[#1b1014e8] px-4 py-3 text-center shadow-lg backdrop-blur-md">
              <div className="font-mono text-[9px] tracking-widest text-red-300">
                NETWORK DATA UNAVAILABLE
              </div>
              <p className="mt-1 max-w-md font-mono text-[10px] leading-relaxed text-red-100/70">
                {networkError}. The geographic basemap remains available.
              </p>
              <p className="mt-1 font-mono text-[9px] text-red-100/50">
                Start FastAPI on http://localhost:8000 to load assets.
              </p>
            </div>
          )}
          {!networkLoading && (
            <MapView
              nodes={visibleNodes}
              edges={edges}
              selected={selected}
              failedId={failedId}
              junctionNumberById={junctionNumberById}
              result={result}
              showAfter={showAfter}
              criticality={criticality}
              assetFilter={assetFilter}
              criticalityFilter={criticalityFilter}
              showLabels={showLabels}
              tileLayerKey={tileLayerKey}
              onZoom={setMapZoom}
              onTileError={() => setTileError(true)}
              onTileLoad={() => setTileError(false)}
              onSelectNode={selectNode}
              onSelectEdge={selectEdge}
              cascadeStage={cascadeStage}
              cascadeProgress={cascadeProgress}
              isCascadePlaying={isCascadePlaying}
            />
          )}
          {tileErrorVisible && !networkError && (
            <div
              className={`pointer-events-none absolute left-1/2 top-4 z-[500] -translate-x-1/2 rounded border border-amber-800/70 bg-[#1b1509e8] px-3 py-2 text-center backdrop-blur-md transition-opacity duration-500 ${
                tileError ? "opacity-100" : "opacity-0"
              }`}
            >
              <div className="font-mono text-[9px] tracking-widest text-amber-300">
                MAP TILES UNAVAILABLE
              </div>
              <div className="mt-1 font-mono text-[9px] text-amber-100/60">
                Check your network connection and reload the map
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute left-4 top-4 z-[500] rounded border border-[#30363d] bg-[#161b22e8] px-3 py-2 backdrop-blur-md">
            <div className="font-mono text-[9px] tracking-[0.18em] text-[#58a6ff]">
              OPERATING GEOGRAPHY
            </div>
            <div className="mt-1 font-display text-base text-white">
              Manipal, Karnataka
            </div>
          </div>
          <div className="map-legend pointer-events-none absolute bottom-4 left-4 z-[500] rounded border border-[#30363d] bg-[#161b22e8] p-3 backdrop-blur-md">
            <div className="map-legend-title mb-3 font-mono text-[8px] tracking-[0.2em] text-[#8b949e]">
              LEGEND
            </div>
            <div className="map-legend-items mb-3 grid grid-cols-3 gap-x-3 gap-y-2 font-mono text-[8px] text-[#8b949e]">
              <span className="map-legend-item"><i className="legend-dot bg-blue-400" />Junction</span>
              {nodes.some((node) => node.type === "hospital") && (
                <span className="map-legend-item"><i className="legend-square bg-red-500">+</i>Hospital</span>
              )}
              {nodes.some((node) => node.type === "depot") && (
                <span className="map-legend-item"><i className="legend-square bg-green-500">■</i>Depot</span>
              )}
            </div>
            <div className="map-legend-state border-t border-[#30363d] pt-3 font-mono text-[8px] text-[#8b949e]">
              <div className="mb-2 text-[7px] tracking-widest text-[#6e7681]">INCIDENT STATE</div>
              <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                <span className="map-legend-item"><i className="legend-dot bg-red-500" />Failed</span>
                <span className="map-legend-item"><i className="legend-dot bg-amber-500" />Affected</span>
                <span className="map-legend-item"><i className="legend-dot bg-purple-500" />Stranded</span>
              </div>
            </div>
          </div>
          <div className="map-overlay-controls absolute right-3 top-3 z-[500] flex items-start gap-2">
            {result && (
              <button
                type="button"
                onClick={() => setShowAfter((value) => !value)}
                className={`map-label-button ${
                  showAfter ? "map-label-button-active" : ""
                }`}
              >
                {showAfter ? "AFTER FAILURE" : "BASELINE"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowLabels((value) => !value)}
              className={`map-label-button ${
                showLabels ? "map-label-button-active" : ""
              }`}
            >
              {showLabels ? "HIDE LABELS" : "SHOW LABELS"}
            </button>
            <div className="rounded border border-[#30363d] bg-[#161b22e8] px-2.5 py-2 font-mono text-[9px] text-[#8b949e] backdrop-blur-md">
              ZOOM {mapZoom.toFixed(1)}
            </div>
          </div>
        </main>
        <aside className="min-h-0 w-full max-w-full shrink-0 overflow-x-hidden overflow-y-auto bg-[#161b22] lg:w-[368px] lg:border-l lg:border-[#30363d]">
          {networkError ? null : (
            <AnalysisPanel
              phase={phase}
              selected={selected}
              result={result}
              explanation={explanation}
              nodes={nodes}
              edges={edges}
              criticality={criticality}
              criticalityLoading={criticalityLoading}
              criticalityError={criticalityError}
              explanationLoading={explanationLoading}
              explanationError={explanationError}
              onSimulate={simulate}
              simulationError={simulationError}
              onSelectNode={selectNode}
              onGenerateReport={generateReport}
              cascadeStage={cascadeStage}
              cascadeProgress={cascadeProgress}
              cascadeMinutes={cascadeMinutes}
              isCascadePlaying={isCascadePlaying}
              onToggleCascade={toggleCascade}
              onSeekCascade={seekCascade}
              showAfter={showAfter}
            />
          )}
        </aside>
      </div>
    </div>
  )
}
