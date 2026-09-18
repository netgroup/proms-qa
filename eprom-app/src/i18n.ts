export type Lang = 'en' | 'it'

export interface Dict {
  productName: string
  tagline: string
  privacyShort: string
  privacyLong: string
  kicker: string
  heroTitle: string
  heroIntro: string
  paperStatus: string
  heroHow1: string
  heroTemplateLink: string
  heroHow2: string
  heroPrivacy: string
  heroContact: string
  heroContactLink: string
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
  productName: 'PROMs Quality Assessment',
  tagline: 'Reliability scoring for remote patient questionnaires',
  privacyShort: 'GDPR compliant — data never leaves your browser',
  privacyLong: '100% in-browser processing — no data sent to any server',
  kicker: 'Clinical questionnaire quality control',
  heroTitle: 'PROMs Quality Assessment',
  heroIntro:
    'This system assesses the response quality of patient-reported outcome measures (PROMs). The methodology is described in the article',
  paperStatus: '(submitted for publication)',
  heroHow1:
    'The idea is simple: add a few control questions to a standard medical questionnaire (PROMs) — for example repeated questions, or questions whose answer is already known. Collect the patients’ responses, arrange them in the format of the ',
  heroTemplateLink: 'Excel template',
  heroHow2:
    ' and upload the file here. A simulation will estimate which questionnaires and which patients are reliable according to this methodology.',
  heroPrivacy:
    'No data ever reaches a server: although this is a website, everything stays local and runs entirely in your browser.',
  heroContact: 'For more information,',
  heroContactLink: 'write to the authors',
  step1: 'Download the template',
  step1sub: 'Get the Excel template (.xlsx)',
  step2: 'Fill in & upload',
  step2sub: 'Enter your data in the template and upload it',
  step3: 'Run the analysis',
  step3sub: 'Everything runs locally, no upload to a server',
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
  productName: 'PROMs Quality Assessment',
  tagline: 'Valutazione dell’affidabilità dei questionari clinici da remoto',
  privacyShort: 'Conforme al GDPR — i dati non lasciano il tuo browser',
  privacyLong: 'Elaborazione 100% nel browser — nessun dato inviato a server',
  kicker: 'Controllo qualità dei questionari clinici',
  heroTitle: 'PROMs Quality Assessment',
  heroIntro:
    'Questo sistema permette di valutare la qualità delle risposte ai questionari somministrati ai pazienti (PROMs). La metodologia è spiegata nell’articolo',
  paperStatus: '(submitted for publication)',
  heroHow1:
    'L’idea è semplice: aggiungi a un questionario medico standard (PROMs) alcune domande di controllo, ad esempio domande ripetute o domande la cui risposta è nota. Raccogli le risposte dei pazienti, riportale nel formato del ',
  heroTemplateLink: 'template Excel',
  heroHow2:
    ' e carica qui il file. Una simulazione stimerà quali questionari e quali pazienti sono attendibili secondo questa metodologia.',
  heroPrivacy:
    'Nessun dato transita sui server: anche se è un sito web, tutti i dati restano locali e vengono elaborati solo nel tuo browser.',
  heroContact: 'Per maggiori informazioni,',
  heroContactLink: 'scrivi agli autori',
  step1: 'Scarica il template',
  step1sub: 'Scarica il template Excel (.xlsx)',
  step2: 'Compila e carica',
  step2sub: 'Inserisci i tuoi dati nel template e caricalo',
  step3: 'Lancia l’analisi',
  step3sub: 'Tutto gira in locale, nessun invio a un server',
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
