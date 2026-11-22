# Aura Prime 0.9.0 beta 1

Teknisk version: `0.9.0-beta.1`, tag `v0.9.0-beta.1`. Udgivelsen efter 0.8.0 beta 1. Den tilføjer lokale modeller og ændrer ikke andet.

## Lokale modeller

Under **Indstillinger › Lokale modeller** kan du hente og køre en AI-model på din egen computer. Intet hentes eller startes, før du vælger det.

- **Maskintjek og anbefaling.** Aura læser computerens hukommelse og viser et katalog på otte åbne modeller med status: Passer, Stramt, Kun til samtale eller For stor. Aura holder 4 GB fri til systemet og bruger på Apple Silicon højst to tredjedele af resten. Den største model med fuld arbejdshukommelse er mærket som anbefalet.
- **Auras indbyggede motor.** Aura henter en fastlåst udgave af llama.cpp (b12633, ca. 17 MB) fra GitHub og modelfilen fra Hugging Face. Begge dele kontrolleres mod fastlåste SHA-256-kontrolsummer, før de bruges, og en afbrudt hentning kan fortsættes. Modellen kører på `127.0.0.1`, port 11617, uden netværksadgang, og stoppes sammen med appen.
- **Ollama som alternativ.** Har du Ollama installeret, kan Aura bede den hente den samme model.
- **Afprøv værktøjskald.** Tre faste, opdigtede opgaver sendes til modellen på computeren: kald et værktøj, kald et værktøj med to argumenter, og svar på resultatet. Resultatet gemmes med dato.
- **Brug.** Modellen startes, og forbindelsen «Aura lokal motor» gemmes, så den kan vælges i projektet som enhver anden AI-forbindelse.

Kataloget, pasformen og reglerne står i [docs/lokale-modeller.md](../lokale-modeller.md).

## Det skal du vide

- **Passer er ikke det samme som kan bygge.** Pasformen handler kun om hukommelse. Katalogets modeller er ikke afprøvet enkeltvis til at bygge, og selv en meget lille model kan bestå afprøvningen af værktøjskald.
- **Lokale modeller er langsommere og mindre dygtige** end de store udbyderes modeller.
- **Dataregler er uændrede.** Hentning af motor og model er spærret i projekter med dataregler, og Aura søger ikke efter Ollama dér. Arbejdsformen «Kun lokal» kræver fortsat, at organisationen har dokumenteret modtageren. Aura registrerer ikke selv sin motor som lokal.
- **Motoren har ingen adgangsnøgle.** Andre programmer på samme computer kan kalde den, mens den kører.
- **Kun macOS på Apple Silicon** har den indbyggede motor i denne pakke. Kildekoden understøtter også Linux på x64.

## Uændret fra 0.8.0 beta 1

Datagennemgang, godkendelser, planvalg, beskyttede filer og Privacy Gate er uændrede. Terminalgrænser, websøgning og MCP forbliver utilgængelige. Appen er ad hoc-signeret og ikke notariseret, så macOS viser en advarsel ved første åbning.

## Opgradering

Opdateringsfeedet har samme form som i 0.8.0 beta 1: én post med opdaterings-ZIP'en under dens relative navn. Tidligere tags og installationsfiler er bevaret.

## Kvalifikation

- Funktionen er udviklet og set i den kørende app i en Linux-kørsel med en efterlignet motor og en efterlignet Ollama: oversigt, pasform, start og stop, afprøvning og hentning gennem Ollama.
- Motorstyring, hentning med genoptagelse og kontrolsum, katalog og pasform er dækket af test.
- Den rigtige llama.cpp-server er afprøvet på Linux med en rigtig model på 0,6 mia. parametre: start, rapporteret kontekst og bestået afprøvning af værktøjskald.
- Workflowet Lokal motor henter de fastlåste filer på en virtuel Apple Silicon-maskine og på Linux, kontrollerer kontrolsummerne, starter motoren med en rigtig lille model og afprøver værktøjskald.
- Ikke afprøvet: en fysisk Mac med en katalogmodel, hentning af en fil på flere GB over en rigtig forbindelse, hentning bag en proxy, Ollama med en rigtig model og hver katalogmodels evne til at bygge.

Udgivelsen bygges, afprøves og uploades fra udgiverens egen Mac med `desktop/scripts/release-local.cjs`. Tallene fra byggemaskinen, kildecommit og kontrolsummer står under Bygning og kontrol.
