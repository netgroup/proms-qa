import ExcelJS from 'exceljs'
import type { ParsedWorkbook, SheetTable } from './types'

export const normKey = (s: string): string => String(s).trim().toLowerCase()

function cellValueToPrimitive(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'object') {
    const obj = v as { result?: unknown; text?: unknown; richText?: unknown; value?: unknown }
    if (obj.richText && Array.isArray(obj.richText)) {
      return (obj.richText as { text?: string }[]).map((r) => r.text ?? '').join('')
    }
    if (obj.result !== undefined) return cellValueToPrimitive(obj.result)
    if (obj.text !== undefined) return cellValueToPrimitive(obj.text)
    if (obj.value !== undefined) return cellValueToPrimitive(obj.value)
    return String(v)
  }
  return v
}

function readSheetAsTable(ws: ExcelJS.Worksheet): SheetTable {
  const rowsRaw: unknown[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const arr: unknown[] = []
    const rowValues = row.values as (unknown[] | Record<number, unknown>)
    // ExcelJS row.values is 1-indexed; index 0 is empty
    if (Array.isArray(rowValues)) {
      for (let i = 1; i < rowValues.length; i++) {
        arr.push(cellValueToPrimitive(rowValues[i]))
      }
    } else {
      const maxCol = ws.columnCount
      for (let i = 1; i <= maxCol; i++) {
        arr.push(cellValueToPrimitive(rowValues[i]))
      }
    }
    rowsRaw.push(arr)
  })
  if (rowsRaw.length === 0) return { headers: [], rows: [], headerMap: new Map() }
  const headerRow = rowsRaw[0].map((h) => (h == null ? '' : String(h).trim()))
  // pad rows to header length
  const rows = rowsRaw.slice(1).map((r) => {
    const padded = r.slice()
    while (padded.length < headerRow.length) padded.push(null)
    return padded
  }).filter((r) => r.some((c) => c != null && String(c).trim() !== ''))
  const headerMap = new Map<string, number>()
  headerRow.forEach((h, i) => {
    if (h) headerMap.set(normKey(h), i)
  })
  return { headers: headerRow, rows, headerMap }
}

function findSheet(wb: ExcelJS.Workbook, wanted: string): ExcelJS.Worksheet | null {
  const target = normKey(wanted)
  for (const ws of wb.worksheets) {
    if (normKey(ws.name) === target) return ws
  }
  return null
}

export async function parseWorkbook(file: File | ArrayBuffer): Promise<ParsedWorkbook> {
  const ab = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(ab)

  const inputWs = findSheet(wb, 'INPUT')
  const mapsWs = findSheet(wb, 'MAPS')
  const configWs = findSheet(wb, 'CONFIG')

  const sheetNames: Record<string, string> = {}
  if (inputWs) sheetNames['INPUT'] = inputWs.name
  if (mapsWs) sheetNames['MAPS'] = mapsWs.name
  if (configWs) sheetNames['CONFIG'] = configWs.name

  const input: SheetTable = inputWs
    ? readSheetAsTable(inputWs)
    : { headers: [], rows: [], headerMap: new Map() }
  const maps: SheetTable = mapsWs
    ? readSheetAsTable(mapsWs)
    : { headers: [], rows: [], headerMap: new Map() }

  let config: string[] = []
  if (configWs) {
    const cfgTable = readSheetAsTable(configWs)
    config = cfgTable.rows.map((r) => (r[0] == null ? '' : String(r[0]).trim())).filter((v) => v !== '')
  }

  return { input, maps, config, sheetNames }
}
