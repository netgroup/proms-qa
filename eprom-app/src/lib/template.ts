import ExcelJS from 'exceljs'
import type { AppConfig } from './types'

const README_TEXT = [
  '1. Fill in the INPUT sheet with Questionnaire_ID, Participant_ID, and the answers',
  '2. Use the MAPS sheet to assign a FeatureType to each answer column (dropdown)',
  '3. Optionally set MIN/MAX per column in MAPS',
  'Do not modify the CONFIG sheet',
]

const SAMPLE_INPUT_HEADERS = [
  'Questionnaire_ID',
  'Participant_ID',
  'Domanda ripetuta',
  'Tempo su tablet',
  'Sei sicuro?',
  'Diff con overall score',
  'Il cielo è blu?',
]

const SAMPLE_INPUT_ROWS: (string | number)[][] = [
  ['QN1', 'P1', 2, 2, 2, 2, 3],
  ['QN2', 'P2', 3, 2, 5, 4, 4],
  ['QN3', 'P1', 1, 4, 1, 1, 5],
]

const SAMPLE_MAPS_ROWS: (string | number | null)[][] = [
  ['Domanda ripetuta', 'Reverse-Coded Items and Repeated Questions', 1, 5],
  ['Tempo su tablet', 'Response Time Analysis', 1, 5],
  ['Sei sicuro?', 'Self-Reported Confidence', 1, 5],
  ['Diff con overall score', 'Counterfactual Questions', 1, 5],
  ['Il cielo è blu?', 'Attention Checks', 1, 5],
]

export async function generateTemplateWorkbook(config: AppConfig): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ePROM Quality Assessment'
  wb.created = new Date()

  // README
  const readmeWs = wb.addWorksheet('README')
  readmeWs.getColumn(1).width = 90
  README_TEXT.forEach((line, i) => {
    readmeWs.getCell(i + 1, 1).value = line
  })

  // INPUT
  const inputWs = wb.addWorksheet('INPUT')
  inputWs.addRow(SAMPLE_INPUT_HEADERS)
  const headerRow = inputWs.getRow(1)
  headerRow.font = { bold: true }
  for (const r of SAMPLE_INPUT_ROWS) inputWs.addRow(r)
  SAMPLE_INPUT_HEADERS.forEach((h, i) => {
    inputWs.getColumn(i + 1).width = Math.max(14, h.length + 2)
  })

  // MAPS
  const mapsWs = wb.addWorksheet('MAPS')
  mapsWs.addRow(['Column Name', 'FeatureType', 'MIN', 'MAX'])
  const mapsHeader = mapsWs.getRow(1)
  mapsHeader.font = { bold: true }
  for (const r of SAMPLE_MAPS_ROWS) mapsWs.addRow(r)
  mapsWs.getColumn(1).width = 28
  mapsWs.getColumn(2).width = 40
  mapsWs.getColumn(3).width = 8
  mapsWs.getColumn(4).width = 8

  // CONFIG (rangelist)
  const configWs = wb.addWorksheet('CONFIG')
  configWs.addRow(['Categorie (non toccare)'])
  configWs.getRow(1).font = { bold: true }
  const featureTypes = Object.keys(config.featureTypeToFamily)
  for (const ft of featureTypes) configWs.addRow([ft])
  configWs.getColumn(1).width = 46
  configWs.state = 'visible'
  configWs.protect('do-not-touch', { selectLockedCells: true, selectUnlockedCells: true })
    .catch(() => { /* protection best-effort */ })

  // Data validation on MAPS.FeatureType (column B, rows 2..1000)
  const lastConfigRow = 1 + featureTypes.length
  const configRange = `CONFIG!$A$2:$A$${lastConfigRow}`
  for (let r = 2; r <= 1000; r++) {
    mapsWs.getCell(`B${r}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [`=${configRange}`],
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Valore non valido',
      error: 'Scegli un FeatureType dall\'elenco a tendina.',
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
