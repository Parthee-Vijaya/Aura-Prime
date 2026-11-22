# Lokale modeller

Aura Prime kan hente og køre AI-modeller på din egen computer. Du finder det under **Indstillinger › Lokale modeller**. Intet hentes eller startes, før du vælger det.

En lokal model er langsommere og mindre dygtig end de store udbyderes modeller. Brug den, når indholdet skal blive på computeren, eller når du vil afprøve noget uden en udbyder.

## Maskintjek og pasform

Aura læser computerens hukommelse og processor og regner ud, hvor meget en model må bruge:

- Der holdes altid 4 GB fri til systemet, Aura og kodeagenten.
- På en Mac med Apple Silicon bruges højst to tredjedele af resten. Det svarer til, hvad macOS lader grafikdelen bruge.
- Med et dedikeret NVIDIA-kort bruges 90 % af kortets lager.
- Uden grafikkort bruges halvdelen af resten, og svarene bliver langsomme.

En model kræver plads til modelfilen, til arbejdshukommelsen (konteksten) og 1 GB til beregninger. Aura prøver tre størrelser af arbejdshukommelse og vælger den største, der kan være der:

| Status | Arbejdshukommelse | Betydning |
|---|---|---|
| Passer | 32.768 tokens | Fuld arbejdshukommelse. |
| Stramt | 16.384 tokens | Lange opgaver bliver sammenfattet tidligere. |
| Kun til samtale | 8.192 tokens | Rækker ikke til at bygge. |
| For stor | – | Kan ikke hentes eller startes. |

Tallene er et skøn. For nogle modeller er skønnet forsigtigt, fordi deres opbygning bruger mindre hukommelse end den almindelige beregning antager.

**At en model passer, betyder ikke, at den kan bygge en app.** Pasformen handler kun om hukommelse.

## Kataloget

Kataloget er lille med vilje. Hver model kommer fra udgiverens eget lager eller fra llama.cpp-projektets, har en åben licens og angiver selv, at den kan kalde værktøjer. Filstørrelse, kontrolsum og udgave er hentet fra Hugging Face og fastlåst i `desktop/core/local-models/catalog.json`. Senest kontrolleret 22. november 2026.

| Model | Udgiver | Parametre | Fil | Kilde | Ollama | Licens |
|---|---|---|---|---|---|---|
| Ministral 3 3B | Mistral AI, Frankrig | 3 mia. | 2,1 GB | [mistralai/Ministral-3-3B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF) | `ministral-3:3b` | apache-2.0 |
| Qwen3 4B | Alibaba (Qwen), Kina | 4 mia. | 2,5 GB | [Qwen/Qwen3-4B-GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF) | `qwen3:4b` | apache-2.0 |
| Ministral 3 8B | Mistral AI, Frankrig | 8 mia. | 5,2 GB | [mistralai/Ministral-3-8B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-8B-Instruct-2512-GGUF) | `ministral-3:8b` | apache-2.0 |
| Qwen3 8B | Alibaba (Qwen), Kina | 8 mia. | 5,0 GB | [Qwen/Qwen3-8B-GGUF](https://huggingface.co/Qwen/Qwen3-8B-GGUF) | `qwen3:8b` | apache-2.0 |
| Ministral 3 14B | Mistral AI, Frankrig | 14 mia. | 8,2 GB | [mistralai/Ministral-3-14B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-14B-Instruct-2512-GGUF) | `ministral-3:14b` | apache-2.0 |
| gpt-oss 20B | OpenAI, USA | 20 mia. | 12,1 GB | [ggml-org/gpt-oss-20b-GGUF](https://huggingface.co/ggml-org/gpt-oss-20b-GGUF) | `gpt-oss:20b` | apache-2.0 |
| Devstral Small 1.1 | Mistral AI, Frankrig | 24 mia. | 14,3 GB | [mistralai/Devstral-Small-2507_gguf](https://huggingface.co/mistralai/Devstral-Small-2507_gguf) | `devstral-small-2:24b` | apache-2.0 |
| Qwen3.8 27B | Alibaba (Qwen), Kina | 27 mia. | 19,4 GB | [ggml-org/Qwen3.8-27B-GGUF](https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF) | `qwen3.8:27b` | apache-2.0 |

Kataloget opdateres med `npm run catalog:local-models -- --write` i `desktop/`. Kommandoen henter størrelse, kontrolsum, licens og modeltal direkte fra kilden.

## To måder at køre en model på

### Auras indbyggede motor

Aura henter en fastlåst udgave af [llama.cpp](https://github.com/ggml-org/llama.cpp) (b12633, MIT-licens, ca. 17 MB) fra projektets udgivelser på GitHub og modelfilen fra Hugging Face. Begge dele kontrolleres mod fastlåste SHA-256-kontrolsummer, før de bruges. En afbrudt hentning kan fortsættes.

- Motoren og modellerne ligger i appens datamappe under `harness/local-models`.
- Motoren lytter kun på `127.0.0.1`, port 11617, og startes uden netværksadgang.
- Én model kører ad gangen. Den stoppes, når du trykker Stop, og når Aura lukkes.
- **Brug** starter modellen og gemmer forbindelsen «Aura lokal motor», som du vælger i projektet som enhver anden AI-forbindelse.
- Motoren findes til macOS på Apple Silicon og Linux på x64. På andre computere bruges Ollama.

### Ollama

Har du [Ollama](https://ollama.com) installeret, kan Aura bede den hente den samme model («Brug Ollama i stedet»). Aura installerer ikke Ollama for dig. For Devstral henter Ollama den nyere Devstral Small 2.

## Afprøvning af værktøjskald

En kodeagent kan kun arbejde, hvis modellen kan kalde et værktøj med gyldige argumenter og bagefter svare på resultatet. **Afprøv værktøjskald** sender tre faste, opdigtede opgaver til modellen på din computer:

1. Kald et værktøj for at læse en fil.
2. Kald et værktøj med to argumenter for at skrive en fil.
3. Svar på værktøjets resultat uden at kalde værktøjet igen.

Resultatet gemmes med dato og vises ved modellen. En bestået afprøvning viser, at grundlaget er til stede. Den viser ikke, at modellen kan gennemføre en større opgave. Selv en meget lille model kan bestå.

## Data og regler

- Hentning af motor og model er kommunikation ud af computeren. Den er spærret i projekter, hvor dataregler er slået til, ligesom andre hentninger.
- Ved hentning kan GitHub og Hugging Face se din IP-adresse og hvilken fil, du henter. Der sendes intet projektindhold.
- Afprøvningen sender kun de tre opdigtede opgaver, og kun til en adresse på denne computer.
- I et projekt med dataregler søger Aura ikke efter Ollama og afprøver ikke modeller gennem Ollama. En lokal server er først en modtager, når den er gemt som forbindelse og godkendt.
- Projektets dataregler gælder fortsat for forbindelsen. Arbejdsformen «Kun lokal» kræver stadig, at din organisation har dokumenteret modtageren i `destinations.json`, som beskrevet i [Privacy Gate](privacy-gate.md#administrativ-registrering). For Auras motor er adressen `http://127.0.0.1:11617/v1` og behandlingsstedet `device`. Aura registrerer ikke selv sin motor som lokal.

## Afgrænsninger

- Den indbyggede motor er afprøvet med rigtige filer på en virtuel Apple Silicon-maskine og på Linux, ikke på en fysisk Mac med en stor model.
- Katalogets modeller er ikke afprøvet enkeltvis til at bygge. Brug afprøvningen på din egen computer.
- Motoren har ingen adgangsnøgle. Andre programmer på samme computer kan kalde den, mens den kører.
- Modeller opdateres ikke automatisk. En ny udgave kræver en ny katalogpost.
- Hentning er ikke afprøvet bag en proxy, der kræver særlig opsætning eller egen certifikatudsteder. Fejler den, kan Ollama bruges i stedet.
- Windows har ingen indbygget motor endnu.

## Ophav

Idéen om at anbefale modeller efter computerens hukommelse er inspireret af Unsloth Studio. Der er ikke brugt kode derfra; Unsloths kode er under AGPL-3.0, og Aura Prime er under EUPL-1.2. Motoren er llama.cpp fra ggml-org (MIT).
