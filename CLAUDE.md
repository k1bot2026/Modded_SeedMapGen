# seedmap

Dit project wordt ontwikkeld via het board en de dispatcher van /Volumes/AI-Workspace/control-plane. Lees docs/PROJECT.md voor doel, architectuur en kwaliteitsnormen.

## Commando's
- installeren: <commando>
- tests: <commando>
- lint en types: <commando>
- alles in één: scripts/verify.sh

## Regels
- Werk alleen aan de kaart die in de opdracht staat. Verander geen scope.
- Wijzig nooit een status op het board. Lezen en commentaar plaatsen mag.
- Geen placeholders, geen afgekapte functies, geen uitgeschakelde tests.
- Test-first waar de kaart gedrag beschrijft.
- Conventional Commits. Kleine commits. Nooit --no-verify.
- Nieuwe dependencies alleen uit de allowlist in docs/PROJECT.md. Anders: escaleren.
- Netwerkverkeer alleen naar de domeinen in docs/PROJECT.md.
- Documenteer alleen het waarom in docs/, nooit wat de code doet.

## Escalatie
Zelf beslissen: implementatiedetails, structuur binnen de geraakte module, tests, dev-dependencies uit de allowlist, lint-fixes.
Escaleren via een commentaar op de kaart (de dispatcher zet de status): scopewijziging, onhaalbaar of strijdig acceptatiecriterium, runtime-dependency buiten de allowlist, publieke API verwijderen of hernoemen, migraties, data verwijderen, secrets, authenticatie, betalingen, nieuwe netwerkdomeinen, security-bevinding high of hoger.
Stel nooit een vraag in de terminal. Schrijf de vraag en je voorgestelde opties in het commentaar en rond af wat je zonder antwoord kunt afronden.

## Afronden
Plaats één commentaar op de kaart: wat is gedaan, welke keuzes en waarom, wat de reviewer moet controleren.
