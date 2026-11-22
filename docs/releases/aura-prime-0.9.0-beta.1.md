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

Udgivelsen bygges, afprøves og uploades af workflowet **Byg og udgiv Mac-beta** på en macOS-maskine i GitHub Actions med `desktop/scripts/release-local.cjs`. Den samlede kontrol af kildekoden indgår ikke i den bygning; workflowet Kildetjek kører skrivebordstestene på macOS for hver commit på `main`. Den pakkede app er afprøvet automatisk, men ingen har set den efter før offentliggørelsen. Kildecommit, accepttrin og kontrolsummer står under Bygning og kontrol.

## Udgivet 22. november 2026

Bygget fra `ffec355c69a9dad367d3f007b9bc07debc5fe846` af workflowet Byg og udgiv Mac-beta på en `macos-15`-maskine med Node 22.23.3 og offentliggjort kl. 19.13 dansk tid. Tagget `v0.9.0-beta.1` peger på samme commit på `main`.

- Den samlede kontrol af kildekoden indgik ikke i bygningen. Kildetjek (skrivebordstestene på macOS) var grønt for samme commit, før bygningen blev startet.
- Accepttesten af den pakkede app: 22 trin, inklusive opgradering fra 0.8.0-beta.1 i samme profil.
- DMG og ZIP er kontrolleret mod den afprøvede app, ad hoc-signeret.

Efter udgivelsen er de fire filer hentet fra GitHub i et særskilt Linux-miljø og kontrolleret: alle matcher `SHA256SUMS.txt`, feedets SHA-512 og størrelse matcher ZIP-filen, feedet har én post og accepteres af opdateringskontrollen i beta 7 og 0.8.0 beta 1, og feedets offentlige adresse svarer uden login. De ti filer for lokale modeller i pakken er identiske med kildecommitten. Resultatet står i [verification.json](aura-prime-0.9.0-beta.1-evidence/verification.json).

Ingen har åbnet den pakkede app og set den efter, og lokale modeller er ikke afprøvet i den pakkede app: hverken hentning af motoren, start af en model eller afprøvning af værktøjskald. Accepttesten åbner ikke Lokale modeller.

Workflowet Byg testpakker startede ikke ved tagget, fordi tagget blev oprettet med workflowets eget token.

## Kontrolsummer

- `Aura-Prime-0.9.0-beta.1-mac-arm64.dmg`: SHA-256 `7838c9a41491e411e0d48b5ecf9f205d060ed8fe928da61cf1cb87af3ab6df7b`
- `Aura-Prime-0.9.0-beta.1-mac-arm64.zip`: SHA-256 `e3f11eb8d00461b04201a81358f5490f6417ca426d5b13e09eca581e89ca6df9`
- `beta-mac.yml`: SHA-256 `f3e0bedafd1f949a9df24344659b9b96231110f51df247ac94feeb94e66c91ad`
- `SHA256SUMS.txt`: SHA-256 `89b08ad29e1c2acde479620916143351a7f0e37dc70643e179017ac10c8bea2e`
