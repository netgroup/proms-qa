export type Lang = 'en' | 'it'

export interface Dict {
  productName: string
  tagline: string
  privacyShort: string
  privacyLong: string
  kicker: string
  heroTitle: string
  heroBody: string
  step1: string
  step1sub: string
  step2: string
  step2sub: string
  step3: string
  step3sub: string
  stepLabel: string
  uploadTitle: string
  downloadTemplate: string
  dropTitle: string
  dropSub: string
  browse: string
  dropHint: string
  validating: string
  fileRejected: string
  fileValid: string
  successTitle: string
  successBody: string
  warnTitle: string
  warnBody: string
  errorTitle: string
  errorBody: string
  row: string
  settingsTitle: string
  settingsHint: string
  seed: string
  chains: string
  warmup: string
  draws: string
  quickMode: string
  quickHint: string
  run: string
  runHintReady: string
  runHintBlocked: string
  analyzing: string
  done: string
  phaseWarmup: string
  phaseSampling: string
  phaseWarmupSub: string
  phaseSamplingSub: string
  diagTitle: string
  diagConverge: string
  diagConvergeVal: string
  diagConvergeBadVal: string
  diagRhat: string
  diagDiv: string
  diagRuntime: string
  resultsTitle: string
  resultsSub: string
  participants: string
  questionnaires: string
  colId: string
  colReliability: string
  colAnomaly: string
  colConfidence: string
  high: string
  medium: string
  low: string
  anomYes: string
  anomNo: string
  downloadResults: string
  legendTitle: string
  legHigh: string
  legMed: string
  legLow: string
  legAnomYes: string
  legAnomNo: string
  legNeutralT: string
  legNeutral: string
  authors: string
  acknowledgement: string
  precisionThanks: string
  precisionFund: string
  toastTemplate: string
  toastResults: string
}

const EN: Dict = {
  productName: 'ePROM Quality Assessment',
  tagline: 'Reliability scoring for remote patient questionnaires',
  privacyShort: 'Runs in your browser',
  privacyLong: '100% in-browser processing — no data sent to any server',
  kicker: 'Clinical questionnaire quality control',
  heroTitle: 'Upload a file. Download the assessment.',
  heroBody:
    'Load the Excel export of your questionnaire responses. The tool scores each patient’s reliability and flags anomalous questionnaires — entirely on your device. Everything else on this page is just there to explain it.',
  step1: 'Upload',
  step1sub: 'Drop the .xlsx exported from the template',
  step2: 'Analyze',
  step2sub: 'Runs locally, no upload to a server',
  step3: 'Download',
  step3sub: 'Get reliability & anomaly scores as .xlsx',
  stepLabel: 'Step',
  uploadTitle: 'Upload your responses',
  downloadTemplate: 'Download Excel template',
  dropTitle: 'Drop your .xlsx file here',
  dropSub: 'or click to browse',
  browse: 'Choose file',
  dropHint: 'Accepted format: .xlsx exported from the template',
  validating: 'Validating file…',
  fileRejected: 'File rejected',
  fileValid: 'File is valid',
  successTitle: 'File is valid',
  successBody: 'Ready to analyze.',
  warnTitle: 'Valid file, with warnings',
  warnBody: 'The file can be analyzed, but review these non-blocking issues:',
  errorTitle: 'File rejected',
  errorBody: 'Correct the following and upload again:',
  row: 'row',
  settingsTitle: 'Analysis settings',
  settingsHint: 'optional, sensible defaults',
  seed: 'Random seed',
  chains: 'Chains',
  warmup: 'Warmup',
  draws: 'Draws',
  quickMode: 'Quick mode',
  quickHint: 'Fewer draws for a faster, approximate result',
  run: 'Run analysis',
  runHintReady: 'Ready — the file is valid.',
  runHintBlocked: 'Upload a valid file to enable analysis.',
  analyzing: 'Analysis in progress',
  done: 'Analysis complete',
  phaseWarmup: 'Warmup',
  phaseSampling: 'Sampling',
  phaseWarmupSub: 'tuning the sampler',
  phaseSamplingSub: 'drawing posterior samples',
  diagTitle: 'Run diagnostics',
  diagConverge: 'Convergence',
  diagConvergeVal: 'all chains converged',
  diagConvergeBadVal: 'convergence warnings',
  diagRhat: 'Max R-hat',
  diagDiv: 'Divergences',
  diagRuntime: 'Runtime',
  resultsTitle: 'Results',
  resultsSub: 'scored locally',
  participants: 'Participants',
  questionnaires: 'Questionnaires',
  colId: 'ID',
  colReliability: 'Reliability',
  colAnomaly: 'Anomaly',
  colConfidence: 'Confidence',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  anomYes: 'Yes',
  anomNo: 'No',
  downloadResults: 'Download results (.xlsx)',
  legendTitle: 'Colour legend',
  legHigh: 'reliable respondent',
  legMed: 'some inconsistency',
  legLow: 'unreliable — review',
  legAnomYes: 'anomalous questionnaire — flagged',
  legAnomNo: 'questionnaire behaves as expected',
  legNeutralT: 'Neutral',
  legNeutral: 'informational / confidence bars',
  authors: 'Authors',
  acknowledgement: 'Acknowledgement',
  precisionThanks: 'This tool is part of the PRECISION project',
  precisionFund:
    'Supported by the Autonomous Region of Sardinia (RAS), Regional Planning Centre, L.R. 12 December 2022, N. 22.',
  toastTemplate: 'Template downloaded',
  toastResults: 'Results downloaded',
}

const IT: Dict = {
  productName: 'ePROM Quality Assessment',
  tagline: 'Valutazione dell’affidabilità dei questionari clinici da remoto',
  privacyShort: 'Gira nel tuo browser',
  privacyLong: 'Elaborazione 100% nel browser — nessun dato inviato a server',
  kicker: 'Controllo qualità dei questionari clinici',
  heroTitle: 'Carica un file. Scarica la valutazione.',
  heroBody:
    'Carica l’esportazione Excel delle risposte ai questionari. Lo strumento valuta l’affidabilità di ogni paziente e segnala i questionari anomali — interamente sul tuo dispositivo. Tutto il resto in questa pagina serve solo a spiegarlo.',
  step1: 'Carica',
  step1sub: 'Trascina il file .xlsx esportato dal template',
  step2: 'Analizza',
  step2sub: 'Calcolo locale, nessun invio a un server',
  step3: 'Scarica',
  step3sub: 'Ottieni affidabilità e anomalie in .xlsx',
  stepLabel: 'Passo',
  uploadTitle: 'Carica le risposte',
  downloadTemplate: 'Scarica template Excel',
  dropTitle: 'Trascina qui il tuo file .xlsx',
  dropSub: 'oppure clicca per selezionare',
  browse: 'Seleziona file',
  dropHint: 'Formato accettato: .xlsx esportato dal template',
  validating: 'Validazione del file…',
  fileRejected: 'File rifiutato',
  fileValid: 'File valido',
  successTitle: 'File valido',
  successBody: 'Pronto per l’analisi.',
  warnTitle: 'File valido, con avvisi',
  warnBody: 'Il file può essere analizzato, ma controlla questi avvisi non bloccanti:',
  errorTitle: 'File rifiutato',
  errorBody: 'Correggi quanto segue e ricarica il file:',
  row: 'riga',
  settingsTitle: 'Impostazioni analisi',
  settingsHint: 'facoltative, valori predefiniti sensati',
  seed: 'Seed casuale',
  chains: 'Catene',
  warmup: 'Warmup',
  draws: 'Campioni',
  quickMode: 'Modalità rapida',
  quickHint: 'Meno campioni per un risultato più veloce e approssimato',
  run: 'Avvia analisi',
  runHintReady: 'Pronto — il file è valido.',
  runHintBlocked: 'Carica un file valido per abilitare l’analisi.',
  analyzing: 'Elaborazione in corso',
  done: 'Analisi completata',
  phaseWarmup: 'Warmup',
  phaseSampling: 'Campionamento',
  phaseWarmupSub: 'calibrazione del campionatore',
  phaseSamplingSub: 'estrazione dei campioni',
  diagTitle: 'Diagnostica del run',
  diagConverge: 'Convergenza',
  diagConvergeVal: 'tutte le catene convergono',
  diagConvergeBadVal: 'avvisi di convergenza',
  diagRhat: 'R-hat max',
  diagDiv: 'Divergenze',
  diagRuntime: 'Durata',
  resultsTitle: 'Risultati',
  resultsSub: 'calcolati localmente',
  participants: 'Partecipanti',
  questionnaires: 'Questionari',
  colId: 'ID',
  colReliability: 'Affidabilità',
  colAnomaly: 'Anomalia',
  colConfidence: 'Confidenza',
  high: 'ALTA',
  medium: 'MEDIA',
  low: 'BASSA',
  anomYes: 'Sì',
  anomNo: 'No',
  downloadResults: 'Scarica risultati (.xlsx)',
  legendTitle: 'Legenda colori',
  legHigh: 'rispondente affidabile',
  legMed: 'qualche incoerenza',
  legLow: 'non affidabile — da rivedere',
  legAnomYes: 'questionario anomalo — segnalato',
  legAnomNo: 'questionario nella norma',
  legNeutralT: 'Neutro',
  legNeutral: 'informativo / barre di confidenza',
  authors: 'Autori',
  acknowledgement: 'Ringraziamenti',
  precisionThanks: 'Questo strumento è parte del progetto PRECISION',
  precisionFund:
    'Supportato dalla Regione Autonoma della Sardegna (RAS), Centro Regionale di Programmazione, L.R. 12 dicembre 2022, N. 22.',
  toastTemplate: 'Template scaricato',
  toastResults: 'Risultati scaricati',
}

export function dict(lang: Lang): Dict {
  return lang === 'it' ? IT : EN
}
