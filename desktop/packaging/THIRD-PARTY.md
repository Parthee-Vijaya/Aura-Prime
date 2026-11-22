# Medfølgende værktøjer

OpenCode 2.1.4 er distribueret som MIT ifølge den officielle npm-pakke @opencode/cli 2.1.4. Aura fastlåser de native @opencode/cli-platformspakker med SHA-512 i runtime-lock.json. Den medfølgende MIT-licenstekst er kontrolleret mod OpenCodes officielle repository ved opgraderingen. Git 2.53.0 fra dugite-native v2.53.0-4 anvendes som separat proces. Git- og byggekildefiler følger med i runtime/sources; se runtime/manifest.json for konkrete adresser og kontrolsummer. Git er GPL-2.0. Dugites JavaScript-værktøj er MIT og medtages ikke i selve appen.

Node.js 22.23.3 og npm medleveres uændret inklusive deres LICENSE-filer. Electron indeholder egne licenser og Chromium notices i app-pakken. De medfølgende Git-arkivers øvrige licens- og noticefiler bevares. Distributionsvilkårene for komponenterne er uafhængige af Aura Harness-projektets egen licens, EUPL-1.2 (se LICENSE i repositoryet).

Pakkerne indeholder ingen AI-model eller betalt konto. Modeludbyderens vilkår og databehandling vælges og gennemgås i appen.

Lokale modeller: pakkerne indeholder hverken llama.cpp eller modelfiler. Vælger brugeren det under Indstillinger › Lokale modeller, henter appen llama.cpp b12633 (MIT, ggml-org) fra projektets udgivelser på GitHub og en modelfil (Apache-2.0) fra udgiverens lager på Hugging Face. Begge dele kontrolleres mod fastlåste SHA-256-kontrolsummer i core/local-models. Aura videredistribuerer dem ikke.
