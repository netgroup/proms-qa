import type {
  AppConfig,
  ParsedWorkbook,
  ValidationIssue,
  ValidationResult,
} from './types'
import { normKey } from './xlsx-io'

const RESERVED_HEADERS = new Set(['questionnaire_id', 'participant_id'])
const MAPS_HEADERS = {
  columnName: 'column name',
  featureType: 'featuretype',
  min: 'min',
  max: 'max',
  minFull: 'minimum value',
  maxFull: 'maximum value',
}

function issue(
  code: string,
  severity: 'error' | 'warning',
  message: string,
  extra: { sheet?: string; column?: string; row?: number } = {},
): ValidationIssue {
  return { code, severity, message, ...extra }
}

function isIntegerLike(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return false
  return Math.abs(n - Math.round(n)) < 1e-9
}

function isCellEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

export function validateWorkbook(wb: ParsedWorkbook, config: AppConfig): ValidationResult {
  const issues: ValidationIssue[] = []
  const push = (i: ValidationIssue) => issues.push(i)

  // E1: missing sheets
  const sheets: Array<'INPUT' | 'MAPS' | 'CONFIG'> = ['INPUT', 'MAPS', 'CONFIG']
  const missingSheets = sheets.filter((s) => !wb.sheetNames[s])
  for (const s of missingSheets) {
    push(
      issue(
        'E1',
        'error',
        `Il file non contiene il foglio obbligatorio "${s}". Il file deve avere i fogli INPUT, MAPS e CONFIG. Scarica il template per la struttura corretta.`,
        { sheet: s },
      ),
    )
  }
  if (missingSheets.length > 0) {
    return { issues, hasErrors: true }
  }

  // E2: required id columns in INPUT
  const qCol = wb.input.headerMap.get('questionnaire_id')
  const pCol = wb.input.headerMap.get('participant_id')
  if (qCol === undefined) {
    push(
      issue('E2', 'error', 'Nel foglio INPUT manca la colonna obbligatoria "Questionnaire_ID".', {
        sheet: 'INPUT',
        column: 'Questionnaire_ID',
      }),
    )
  }
  if (pCol === undefined) {
    push(
      issue('E2', 'error', 'Nel foglio INPUT manca la colonna obbligatoria "Participant_ID".', {
        sheet: 'INPUT',
        column: 'Participant_ID',
      }),
    )
  }

  // signal columns = every INPUT header not in RESERVED
  const signalColumns: { name: string; idx: number }[] = []
  wb.input.headers.forEach((h, i) => {
    if (!h) return
    if (RESERVED_HEADERS.has(normKey(h))) return
    signalColumns.push({ name: h, idx: i })
  })

  // E3: no signal columns
  if (signalColumns.length === 0) {
    push(
      issue(
        'E3',
        'error',
        'Il foglio INPUT non contiene nessuna colonna di risposte oltre a Questionnaire_ID e Participant_ID.',
        { sheet: 'INPUT' },
      ),
    )
  }

  // E4: no data rows
  if (wb.input.rows.length === 0) {
    push(
      issue('E4', 'error', 'Il foglio INPUT non contiene righe di dati.', { sheet: 'INPUT' }),
    )
  }

  // MAPS structure
  const mapsColName = wb.maps.headerMap.get(MAPS_HEADERS.columnName)
  const mapsFeatureType = wb.maps.headerMap.get(MAPS_HEADERS.featureType)
  const mapsMin = wb.maps.headerMap.get(MAPS_HEADERS.minFull) ?? wb.maps.headerMap.get(MAPS_HEADERS.min)
  const mapsMax = wb.maps.headerMap.get(MAPS_HEADERS.maxFull) ?? wb.maps.headerMap.get(MAPS_HEADERS.max)

  if (mapsColName === undefined || mapsFeatureType === undefined) {
    push(
      issue(
        'E1',
        'error',
        'Nel foglio MAPS mancano le colonne obbligatorie "Column Name" e/o "FeatureType".',
        { sheet: 'MAPS' },
      ),
    )
    return { issues, hasErrors: true }
  }

  // CONFIG rangelist (single source of truth for allowed feature types)
  const configSet = new Set(wb.config.map((v) => normKey(v)))
  const configOriginal = new Map(wb.config.map((v) => [normKey(v), v]))
  const knownDirectTypes = Object.entries(config.featureTypeToFamily)
    .filter(([, fam]) => fam === 'direct')
    .map(([name]) => name)

  // Build a map from MAPS: column name -> {rowIdx (1-based), featureType, minIdx, maxIdx}
  interface MapEntry {
    row: number
    columnName: string
    featureType: string
    min: number | null
    max: number | null
  }
  const mapEntries: MapEntry[] = []
  const mapByColName = new Map<string, MapEntry>()

  wb.maps.rows.forEach((r, i) => {
    const rawName = r[mapsColName]
    const rawType = r[mapsFeatureType]
    const rawMin = mapsMin !== undefined ? r[mapsMin] : null
    const rawMax = mapsMax !== undefined ? r[mapsMax] : null
    const name = rawName == null ? '' : String(rawName).trim()
    const ft = rawType == null ? '' : String(rawType).trim()
    if (name === '' && ft === '') return
    const min = rawMin != null && rawMin !== '' && Number.isFinite(Number(rawMin)) ? Number(rawMin) : null
    const max = rawMax != null && rawMax !== '' && Number.isFinite(Number(rawMax)) ? Number(rawMax) : null
    const entry: MapEntry = {
      row: i + 2, // header is row 1
      columnName: name,
      featureType: ft,
      min,
      max,
    }
    mapEntries.push(entry)
    if (name) mapByColName.set(normKey(name), entry)
  })

  // E6: every MAPS row must have valid featureType from CONFIG rangelist
  for (const m of mapEntries) {
    if (m.featureType === '') {
      push(
        issue(
          'E6',
          'error',
          `Nel foglio MAPS, riga ${m.row}: manca il FeatureType per la colonna "${m.columnName}".`,
          { sheet: 'MAPS', column: m.columnName, row: m.row },
        ),
      )
    } else if (!configSet.has(normKey(m.featureType))) {
      push(
        issue(
          'E6',
          'error',
          `Nel foglio MAPS, riga ${m.row}: il FeatureType "${m.featureType}" non è tra quelli ammessi nel foglio CONFIG. Scegli un valore dall'elenco a tendina.`,
          { sheet: 'MAPS', column: m.columnName, row: m.row },
        ),
      )
    }
  }

  // E5: every INPUT signal column must have MAPS row
  for (const sc of signalColumns) {
    if (!mapByColName.has(normKey(sc.name))) {
      push(
        issue(
          'E5',
          'error',
          `La colonna "${sc.name}" del foglio INPUT non è mappata nel foglio MAPS: assegna un FeatureType a ogni colonna di risposta.`,
          { sheet: 'INPUT', column: sc.name },
        ),
      )
    }
  }

  // E7 (warning): MAPS row references a column that doesn't exist in INPUT
  const inputColNamesLc = new Set(signalColumns.map((s) => normKey(s.name)))
  for (const m of mapEntries) {
    if (m.columnName && !inputColNamesLc.has(normKey(m.columnName))) {
      push(
        issue(
          'E7',
          'warning',
          `Nel foglio MAPS la riga per "${m.columnName}" non corrisponde a nessuna colonna di INPUT: verrà ignorata.`,
          { sheet: 'MAPS', column: m.columnName, row: m.row },
        ),
      )
    }
  }

  // E8: at least one direct-family column (after mapping)
  let hasDirect = false
  for (const sc of signalColumns) {
    const m = mapByColName.get(normKey(sc.name))
    if (!m) continue
    const canonical = configOriginal.get(normKey(m.featureType)) ?? m.featureType
    const fam = config.featureTypeToFamily[canonical] ?? config.featureTypeToFamily[m.featureType]
    if (fam === 'direct') {
      hasDirect = true
      break
    }
  }
  if (!hasDirect && signalColumns.length > 0) {
    push(
      issue(
        'E8',
        'error',
        `Nessuna colonna è mappata a una categoria di affidabilità diretta: serve almeno una colonna tra { ${knownDirectTypes.join(', ')} } perché il modello funzioni.`,
        { sheet: 'MAPS' },
      ),
    )
  }

  // Values validation: E9 (non-integer), E10 (out of range), W2 (empty column)
  const emptyColumns: string[] = []
  for (const sc of signalColumns) {
    const m = mapByColName.get(normKey(sc.name))
    if (!m) continue
    // Determine effective MIN/MAX
    let observedMin: number | null = null
    let observedMax: number | null = null
    let hasAnyValue = false
    let hadInvalid = false

    wb.input.rows.forEach((row, rIdx) => {
      const v = row[sc.idx]
      if (isCellEmpty(v)) return
      hasAnyValue = true
      if (!isIntegerLike(v)) {
        hadInvalid = true
        push(
          issue(
            'E9',
            'error',
            `La colonna "${sc.name}" (foglio INPUT, riga ${rIdx + 2}) contiene il valore non intero "${String(v)}". Sono ammessi solo numeri interi.`,
            { sheet: 'INPUT', column: sc.name, row: rIdx + 2 },
          ),
        )
        return
      }
      const n = Math.round(Number(v))
      observedMin = observedMin === null ? n : Math.min(observedMin, n)
      observedMax = observedMax === null ? n : Math.max(observedMax, n)
    })

    if (!hasAnyValue) {
      emptyColumns.push(sc.name)
      continue
    }

    // Effective min/max
    let effectiveMin: number
    if (m.min !== null) {
      effectiveMin = m.min
    } else if (observedMin !== null && observedMin > 0) {
      // if column doesn't already contain 0, keep observed min; if contains 0, MIN=0 (D2)
      effectiveMin = observedMin
    } else {
      effectiveMin = 0
    }
    const effectiveMax = m.max !== null ? m.max : (observedMax ?? 1)

    if (effectiveMax <= effectiveMin) {
      push(
        issue(
          'E10',
          'error',
          `La colonna "${sc.name}": intervallo [${effectiveMin}, ${effectiveMax}] non valido (MAX deve essere > MIN).`,
          { sheet: 'INPUT', column: sc.name },
        ),
      )
      continue
    }

    // E10: check range
    if (!hadInvalid) {
      wb.input.rows.forEach((row, rIdx) => {
        const v = row[sc.idx]
        if (isCellEmpty(v)) return
        const n = Number(v)
        if (n < effectiveMin || n > effectiveMax) {
          push(
            issue(
              'E10',
              'error',
              `La colonna "${sc.name}" (foglio INPUT, riga ${rIdx + 2}) contiene il valore ${n}, fuori dall'intervallo consentito [${effectiveMin}, ${effectiveMax}].`,
              { sheet: 'INPUT', column: sc.name, row: rIdx + 2 },
            ),
          )
        }
      })
    }
  }

  for (const col of emptyColumns) {
    push(
      issue('W2', 'warning', `La colonna "${col}" è completamente vuota e verrà ignorata.`, {
        sheet: 'INPUT',
        column: col,
      }),
    )
  }

  // W1: participant with only one questionnaire
  if (pCol !== undefined) {
    const counts = new Map<string, number>()
    for (const row of wb.input.rows) {
      const pid = row[pCol]
      if (isCellEmpty(pid)) continue
      const k = String(pid)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    for (const [pid, n] of counts) {
      if (n === 1) {
        push(
          issue(
            'W1',
            'warning',
            `Il partecipante "${pid}" ha un solo questionario: la deviazione questionario-specifica non è stimabile e sarà ≈0.`,
            { sheet: 'INPUT', column: 'Participant_ID' },
          ),
        )
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error')
  return { issues, hasErrors }
}
