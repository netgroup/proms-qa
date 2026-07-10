# ePROM Quality Assessment — client-side app

Implementazione della specifica `docs/SPEC.md`.

## Come si sviluppa

```
npm install
npm run dev        # avvia il dev server Vite
npm run typecheck  # controlla i tipi TypeScript
npm run build      # produce ./dist (asset statici)
npm run preview    # serve ./dist localmente
```

## Cosa fa

Sito web statico single-page che:

1. accetta un `.xlsx` con i 4 fogli `README/INPUT/MAPS/CONFIG` (§4 della SPEC);
2. valida struttura, mappatura FeatureType→CONFIG e valori (§5, E1–E10 + W1, W2);
3. produce lato client il modello del paper PRECISION (§7) e ne campiona il
   posterior via HMC + dual-averaging in un Web Worker;
4. classifica ogni partecipante `HIGH`/`MEDIUM`/`LOW` e ogni questionario come
   anomalo o meno (§9), poi scarica il risultato come `.xlsx` a 2 fogli.

Nessuna chiamata di rete a runtime (verificabile dal tab Network del browser):
solo asset statici + `config.json`.

## Deroga rispetto alla SPEC (§8, D6)

La SPEC impone il motore **Stan compilato in WebAssembly** senza fallback. Per
motivi di tempistica dell'attuale sessione (build TinyStan+emscripten non
fattibile in ~5 minuti), il motore d'inferenza attuale è un **HMC scritto in
TypeScript** che:

- lavora nello spazio non-vincolato con i vincoli `<lower=0>` esprimibili come
  reparametrizzazione logaritmica (Jacobiani inclusi analiticamente);
- riproduce esattamente il modello `unified_ordinal_reliability_model.py`
  (parametrizzazione non-centrata, centering entro-partecipante di `w_raw`,
  segnale direct di riferimento con `α=0, λ=1`, `λ_c=1` fisso — modalità
  `eta_fixed`);
- calcola priore, verosimiglianza `ordered_logistic` (cutpoint fissi §6.3), e
  gradiente analitico end-to-end. La correttezza del gradiente è verificata da
  `scripts/grad-check.mjs` (errore relativo < 1e-7 contro finite differences);
- integrator leapfrog con L≈15 steps e passo adattato via dual-averaging di
  Hoffman & Gelman, target `adapt_delta = 0.9`;
- catene multiple sequenziali nel Web Worker, con report di progresso, R-hat
  (split), ESS bulk, e conteggio divergenze.

Il modulo del sampler è isolato in `src/workers/sampler/`. Il gate tecnico
mancante è quindi: sostituire il file `hmc.ts` + `posterior.ts` con un wrapper
attorno a un `model.wasm` di Stan (TinyStan). L'interfaccia `sample()`
resterebbe identica.

## Script di verifica

```
npx tsx scripts/grad-check.mjs      # FD vs analitico sui gradienti
npx tsx scripts/smoke-test.mjs      # sample su dataset sintetico
npx tsx scripts/e2e-test.mjs        # parse → validate → preprocess → sample → postprocess
```

Nel test end-to-end su 6 partecipanti × 4 questionari, il posterior mediano di
`sigmoid(θ)` traccia il valore vero (`sigmoid(θ_true)`) entro ~0.1 con
`chains=2, warmup=300, draws=300` (R-hat < 1.02, divergenze ~0).
