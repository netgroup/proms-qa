import ExcelJS from 'exceljs'
import type { AppConfig } from './types'

const README_TITLE = 'PROMS QA'
const README_SUBTITLE = 'How to fill in this template'
const README_STEPS = [
  'Fill in the INPUT sheet with Questionnaire_ID, Participant_ID, and the answers',
  'Use the MAPS sheet to assign a FeatureType to each answer column (dropdown)',
  'Set the minimum and maximum value of each answer in the Minimum/Maximum Value columns of MAPS',
]
const README_NOTE = 'Do not modify the CONFIG sheet'

const SAMPLE_HEADERS = [
  'Example of a repeated question',
  'Example of a response time (e.g. time on tablet)',
  "Example of a confidence question like 'are you sure?'",
  'Example of a counterfactual question (e.g. self-reported average symptom severity vs. the mean computed from individual items)',
  "Example of an attention check like 'is the sky blue?'",
]

// FeatureType keys are technical values shared with CONFIG — never localized
const SAMPLE_FEATURE_TYPES = [
  'Reverse-Coded Items and Repeated Questions',
  'Response Time Analysis',
  'Self-Reported Confidence',
  'Counterfactual Questions',
  'Attention Checks',
]

const SAMPLE_INPUT_ROWS: (string | number)[][] = [
  ['QN1', 'P1', 2, 2, 2, 2, 3],
  ['QN2', 'P2', 3, 2, 5, 4, 4],
  ['QN3', 'P1', 1, 4, 1, 1, 5],
]

const ACCENT = 'FF1F4E79' // dark blue
const ACCENT_LIGHT = 'FFDCE6F1'

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  row.height = 28
}

export async function generateTemplateWorkbook(config: AppConfig): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PROMs Quality Assessment'
  wb.created = new Date()

  // README
  const readmeWs = wb.addWorksheet('README', {
    views: [{ showGridLines: false }],
  })
  readmeWs.getColumn(1).width = 110
  const titleCell = readmeWs.getCell(1, 1)
  titleCell.value = README_TITLE
  titleCell.font = { bold: true, size: 20, color: { argb: ACCENT } }
  readmeWs.getRow(1).height = 34
  const subtitleCell = readmeWs.getCell(2, 1)
  subtitleCell.value = README_SUBTITLE
  subtitleCell.font = { italic: true, size: 12, color: { argb: 'FF666666' } }
  README_STEPS.forEach((line, i) => {
    const cell = readmeWs.getCell(i + 4, 1)
    cell.value = `${i + 1}. ${line}`
    cell.font = { size: 12 }
    cell.alignment = { wrapText: true, vertical: 'top' }
    readmeWs.getRow(i + 4).height = 20
  })
  const noteCell = readmeWs.getCell(4 + README_STEPS.length + 1, 1)
  noteCell.value = `⚠ ${README_NOTE}`
  noteCell.font = { bold: true, size: 12, color: { argb: 'FF9C0006' } }

  // INPUT
  const inputHeaders = ['Questionnaire_ID', 'Participant_ID', ...SAMPLE_HEADERS]
  const inputWs = wb.addWorksheet('INPUT', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  inputWs.addRow(inputHeaders)
  styleHeaderRow(inputWs.getRow(1))
  for (const r of SAMPLE_INPUT_ROWS) inputWs.addRow(r)
  inputHeaders.forEach((h, i) => {
    inputWs.getColumn(i + 1).width = Math.max(16, Math.min(h.length + 2, 44))
  })

  // MAPS
  const mapsWs = wb.addWorksheet('MAPS', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  mapsWs.addRow(['Column Name', 'FeatureType', 'Minimum Value', 'Maximum Value'])
  styleHeaderRow(mapsWs.getRow(1))
  SAMPLE_HEADERS.forEach((h, i) => {
    mapsWs.addRow([h, SAMPLE_FEATURE_TYPES[i], 1, 5])
  })
  mapsWs.getColumn(1).width = 44
  mapsWs.getColumn(2).width = 42
  mapsWs.getColumn(3).width = 15
  mapsWs.getColumn(4).width = 15

  // CONFIG (rangelist)
  const configWs = wb.addWorksheet('CONFIG')
  configWs.addRow(['Category'])
  styleHeaderRow(configWs.getRow(1))
  const featureTypes = Object.keys(config.featureTypeToFamily)
  featureTypes.forEach((ft, i) => {
    const row = configWs.addRow([ft])
    if (i % 2 === 1) {
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_LIGHT } }
    }
  })
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
      errorTitle: 'Invalid value',
      error: 'Choose a FeatureType from the dropdown list.',
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
