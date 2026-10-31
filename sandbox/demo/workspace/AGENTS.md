# AGENTS.md – payments-demo

TypeScript-Projekt (Bun) für Warenkörbe. Beträge sind immer **ganze Cent** (Zahlen, keine Fließkomma-Euro).

- Code in `src/`, Tests in `test/` (`bun test`).
- `src/checkout.ts`: Gesamtpreis und Rabatte. `src/rules.ts`: Versandkosten.
- `mainframe/`: COBOL-Programme (PAYCALC ruft TAXCALC), Copybook EMPREC, JCL PAYRUN.
- Änderungen immer klein halten und mit `bun test` prüfen.
