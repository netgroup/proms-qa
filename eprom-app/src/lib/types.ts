export type Family = 'direct' | 'fatigue' | 'confidence'

export interface AppConfig {
  featureTypeToFamily: Record<string, Family>
  reliabilityHighThreshold: number
  reliabilityLowThreshold: number
  anomalyScoreThreshold: number
  anomalyMinPredictiveProbability: number
  defaultMcmc: McmcSettings
  quickModeMcmc: Partial<McmcSettings>
}

export interface McmcSettings {
  seed: number
  chains: number
  warmup: number
  draws: number
  adaptDelta: number
}

export interface ParsedWorkbook {
  input: SheetTable
  maps: SheetTable
  config: string[]
  sheetNames: Record<string, string>
}

export interface SheetTable {
  headers: string[]
  rows: unknown[][]
  headerMap: Map<string, number>
}

export type IssueSeverity = 'error' | 'warning'

export interface ValidationIssue {
  code: string
  severity: IssueSeverity
  message: string
  sheet?: string
  column?: string
  row?: number
}

export interface ValidationResult {
  issues: ValidationIssue[]
  hasErrors: boolean
}

export interface SignalColumn {
  name: string
  family: Family
  featureType: string
  values: Float64Array
  maxScore: number
  min: number
  max: number
}

export interface PreprocessedData {
  nParticipants: number
  nQuestionnaires: number
  participantIndex: Int32Array
  participantLabels: string[]
  questionnaireIds: string[]
  directCols: SignalColumn[]
  fatigueCols: SignalColumn[]
  confidenceCols: SignalColumn[]
}

export interface StanData {
  N: number
  T: number
  participantIdx: Int32Array
  direct: FamilyData
  fatigue: FamilyData
  confidence: FamilyData
}

export interface FamilyData {
  nCols: number
  maxScores: Int32Array
  obsValues: Int32Array
  obsQuestIdx: Int32Array
  obsColIdx: Int32Array
}

export interface PosteriorDraws {
  baselineReliability: Float64Array
  questionnaireReliability: Float64Array
  b: Float64Array | null
  yRep: Record<string, Int32Array>
  scalarNames: string[]
  scalars: Float64Array
  nDraws: number
  N: number
  T: number
}

export interface Diagnostics {
  rHatMax: number
  essMin: number
  divergences: number
  runtimeMs: number
  converged: boolean
}

export interface SamplerResult {
  draws: PosteriorDraws
  diagnostics: Diagnostics
}

export interface WorkerMessage {
  type: 'progress' | 'done' | 'error'
  progress?: {
    chain: number
    totalChains: number
    phase: 'warmup' | 'sampling'
    percent: number
  }
  result?: SerializedSamplerResult
  error?: string
}

export interface SerializedSamplerResult {
  draws: {
    baselineReliability: number[]
    questionnaireReliability: number[]
    b: number[] | null
    yRep: Record<string, number[]>
    scalarNames: string[]
    scalars: number[]
    nDraws: number
    N: number
    T: number
  }
  diagnostics: Diagnostics
}

export interface ParticipantRow {
  id: string
  reliability: 'HIGH' | 'MEDIUM' | 'LOW'
  confidence: number
}

export interface QuestionnaireRow {
  id: string
  anomaly: boolean
  confidence: number
}

export interface OutputTables {
  participants: ParticipantRow[]
  questionnaires: QuestionnaireRow[]
}
