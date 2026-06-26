/**
 * Radial engine public surface.
 *
 * T09. Other engines (T10-T13) will follow the same pattern.
 */

export { runRadialEngine } from "./engine.js";
export {
  makeSignalId,
  isEdgeKindAllowed,
  nodeHasBoundaryTag,
  SEVERITY_RANK,
  type Signal,
  type SignalType,
  type SignalTargetKind,
  type SeverityHint,
  type RadialSignalType,
} from "./signals.js";
