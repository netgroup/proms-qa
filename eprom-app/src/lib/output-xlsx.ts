import ExcelJS from 'exceljs'
import type { OutputTables } from './types'

export async function buildOutputWorkbook(tables: OutputTables): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ePROM Quality Assessment'
  wb.created = new Date()

  const pWs = wb.addWorksheet('participants')
  pWs.addRow(['', 'Reliability', 'Reliability confidence'])
  const pHead = pWs.getRow(1)
  pHead.getCell(1).value = null
  pHead.getCell(2).font = { bold: true }
  pHead.getCell(3).font = { bold: true }
  for (const p of tables.participants) {
    const row = pWs.addRow([p.id, p.reliability, Math.round(p.confidence * 1e6) / 1e6])
    row.getCell(3).numFmt = '0.000000'
  }
  pWs.getColumn(1).width = 22
  pWs.getColumn(2).width = 14
  pWs.getColumn(3).width = 22

  const qWs = wb.addWorksheet('questionnaires')
  qWs.addRow(['', 'Anomaly', 'Anomaly confidence'])
  const qHead = qWs.getRow(1)
  qHead.getCell(1).value = null
  qHead.getCell(2).font = { bold: true }
  qHead.getCell(3).font = { bold: true }
  for (const q of tables.questionnaires) {
    const row = qWs.addRow([q.id, q.anomaly, Math.round(q.confidence * 1e6) / 1e6])
    // Native boolean value (ExcelJS writes boolean type when value is a JS boolean)
    row.getCell(2).value = q.anomaly
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
