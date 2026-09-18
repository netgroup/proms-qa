import ExcelJS from 'exceljs'
import type { OutputTables } from './types'

const ACCENT = 'FF1F4E79' // dark blue, same as the template

// Classic Excel conditional-formatting palettes (fill + font)
const GOOD = { fill: 'FFC6EFCE', font: 'FF006100' }
const NEUTRAL = { fill: 'FFFFEB9C', font: 'FF9C6500' }
const BAD = { fill: 'FFFFC7CE', font: 'FF9C0006' }

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } }
    cell.alignment = { vertical: 'middle' }
  })
  row.height = 24
}

function colorBadge(cell: ExcelJS.Cell, palette: { fill: string; font: string }) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: palette.fill } }
  cell.font = { bold: true, color: { argb: palette.font } }
  cell.alignment = { horizontal: 'center' }
}

export async function buildOutputWorkbook(tables: OutputTables): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PROMs Quality Assessment'
  wb.created = new Date()

  const pWs = wb.addWorksheet('participants', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  pWs.addRow(['Participant_ID', 'Reliability', 'Reliability confidence'])
  styleHeaderRow(pWs.getRow(1))
  for (const p of tables.participants) {
    const row = pWs.addRow([p.id, p.reliability, Math.round(p.confidence * 1e6) / 1e6])
    const relCell = row.getCell(2)
    if (p.reliability === 'HIGH') colorBadge(relCell, GOOD)
    else if (p.reliability === 'MEDIUM') colorBadge(relCell, NEUTRAL)
    else colorBadge(relCell, BAD)
    row.getCell(3).numFmt = '0.000000'
  }
  pWs.getColumn(1).width = 22
  pWs.getColumn(2).width = 14
  pWs.getColumn(3).width = 22

  const qWs = wb.addWorksheet('questionnaires', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  qWs.addRow(['Questionnaire_ID', 'Anomaly', 'Anomaly confidence'])
  styleHeaderRow(qWs.getRow(1))
  for (const q of tables.questionnaires) {
    const row = qWs.addRow([q.id, q.anomaly, Math.round(q.confidence * 1e6) / 1e6])
    // Native boolean value (ExcelJS writes boolean type when value is a JS boolean)
    const anomCell = row.getCell(2)
    anomCell.value = q.anomaly
    colorBadge(anomCell, q.anomaly ? BAD : GOOD)
    row.getCell(3).numFmt = '0.000000'
  }
  qWs.getColumn(1).width = 22
  qWs.getColumn(2).width = 12
  qWs.getColumn(3).width = 22

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
