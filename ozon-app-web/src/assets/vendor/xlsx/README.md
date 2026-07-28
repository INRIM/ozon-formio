# xlsx.full.min.js — provenienza

Bundle UMD "full" di SheetJS Community Edition, caricato a runtime via
`<script src="assets/vendor/xlsx/xlsx.full.min.js">` da
`RecordTransferToolsComponent.ensureXlsxRuntime()` (espone `window.XLSX`).

Non è gestito da npm: il pacchetto `xlsx` su npmjs.org è fermo a una versione
vulnerabile e non più mantenuto. Le build corrette sono distribuite solo da
SheetJS direttamente.

- **Versione:** 0.20.3
- **Data aggiornamento:** 2026-07-28
- **Fonte:** `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` → `dist/xlsx.full.min.js`
- **Motivo aggiornamento:** la 0.17.3 precedente era affetta da
  CVE-2023-30533 (prototype pollution in lettura file, corretta in 0.19.3) e
  CVE-2024-22363 (ReDoS, corretta in 0.20.2). Verificare `XLSX.version` nel
  bundle corrisponda a quanto dichiarato qui prima di ogni prossimo aggiornamento.

Per aggiornare: scaricare il tarball dalla versione desiderata da
`https://cdn.sheetjs.com/`, estrarre `dist/xlsx.full.min.js`, sostituire questo
file e aggiornare i campi sopra.
