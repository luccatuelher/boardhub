# BoardHub — análise do código e melhorias possíveis

Análise de `index.html` (commit `b0fc9a4`, out/2026), revisada por um consultor Opus que reverificou as afirmações no código. Tudo vive em um único arquivo de ~1,3 MB, sem build: ~97 KB de CSS, ~14,9 mil linhas / ~1 MB de JSX compilado no navegador e um WebP de ~200 KB em base64 (linha 881). Números vêm de `grep`/leitura; o que foi rastreado no código mas não reproduzido no navegador está marcado **(plausível)**.

**Resumo:** o app é cuidadoso onde mais importa (backup, sync transacional, sanitização, allowlist de embeds, focus-trap, reduced-motion). Os riscos reais são, em ordem: **(1) armazenamento local frágil** (localStorage como primário, sem `storage.persist()`, cache "descartável" guardando dados que não são descartáveis), **(2) sync legado que reenvia seções inteiras** enquanto o transporte por entidade (v4), já pronto, não é o padrão, **(3) zero testes** em lógica de merge/rank/sanitização, **(4) dependência de CDNs e compilação no navegador**, e **(5) manutenibilidade** (arquivo único, componentes com 1.000+ linhas).

---

## Prioridade alta

### 1. Armazenamento local
- **O localStorage é o armazenamento primário e a "cópia de emergência" ocupa metade da cota.** Toda captura bem-sucedida regrava o estado inteiro (`bhEmergencySave`, linhas 1751–1757, chamada em 1879) ao lado de `boardhub_v2` (1103), mais até 3 cópias em `BH_FALLBACK_KEY`. Duas cópias integrais dividem os ~5 MB por origem; quando o estado cresce, `lsSave` falha (1105–1109). Existe banner e cópia no IndexedDB (14262–14275), mas no boot o app lê o `LS_KEY` desatualizado. Caminho: mover o estado primário para o IndexedDB e deixar o localStorage só como índice/flag.
- **Nada chama `navigator.storage.persist()`** (confirmado por grep). Safari/iOS apaga dados de sites após ~7 dias sem uso e o Chrome despeja armazenamento "best-effort" quando falta espaço; isso pode levar mídia que só existe localmente (`_storeIdb`, 3508; recusa do Imgur, 3720), o histórico de backups e a base de sync. Pedir persistência e mostrar o resultado na tela de Sync.
- **Cache "descartável" sem evicção guardando dados que não são descartáveis.** `boardhub_media_cache_v1` guarda o blob de toda imagem remota vista (3407–3414) e nunca apaga; no mesmo banco ficam a base do merge de 3 vias (`syncbase:`, 2894) e o cache de entidades (3256), com erros de escrita engolidos (3376). Com a cota cheia, `bhCapture` falha (bloqueando aplicar a nuvem, 14983) e a base se perde (o sync trava pedindo escolha manual, 14892–14895). Separar: cache de mídia com LRU/limite; base de sync e entidades em store próprio.
- **O documento `state` cresce sem limite.** `rank.sessions` só recebe itens (4850) e `pomoData.days` também; nenhuma poda encontrada. É o caminho mais provável para o `state` bater o teto, não só `notes`/`gallery`. Definir política de retenção/compactação (por exemplo, agregar sessões antigas).

### 2. Sync
- **O sync legado reenvia a seção inteira a cada ciclo.** A transação lê os documentos completos (3306) e regrava o campo `notes` inteiro (3338–3344); o pump roda a cada 3 s após 1,5 s sem edição (15262, 15288) e o eco do listener baixa tudo de novo. Digitar uma nota custa ~1 MB de subida e ~2 MB de descida por ciclo em 4G.
- **O transporte v4 por entidade já existe e está completo** (preparação/validação 3137–3166, push transacional 3172–3210, listener com diário de deltas 3213–3268, quebra de strings grandes 3076; limite por entidade de 900 KB, 3200). O teto de 950 KB (3325) só vale no modo legado. O que falta não é concluir o v4: é **torná-lo o padrão/automático** (hoje é um botão manual no SyncHub, 13316–13322), com detecção de clientes antigos e testes. A mensagem de erro de 3325 também deveria sugerir a migração.
- No v4, `bhEntityPack(state)` empacota o estado inteiro a cada push (3175) e os `tx.get` rodam em série (3194–3196); podem ir em paralelo.
- **Edição simultânea da mesma nota perde um dos lados (plausível).** No merge por campo, o local vence o HTML inteiro (2948). O aviso de conflito do `RichEditor` some no próximo autosave: o timer de 800 ms segue ativo e, quando `incoming===lastEmitted`, o conflito é limpo em silêncio (11114–11116, 11198–11201). No outro dispositivo, `routineCovered` (14956) pula o backup pré-sync se há um com menos de 5 min. Fazer o conflito de nota não sumir sozinho e arquivar sempre a versão perdida.
- **Um ID duplicado desliga o merge por ID da lista inteira.** `keyed` exige IDs únicos (2909); com um duplicado a lista cai em "local vence" (2948) e o push apaga adições do outro dispositivo. Há 17 IDs com `Date.now()` e os dados de exemplo usam `id:1`, `id:2` (1984). Esse é o motivo real para `crypto.randomUUID()`.
- **Relógio adiantado pode zerar pontuação (plausível).** Um dispositivo com relógio à frente fecha a temporada e envia um `seasonId` "futuro"; os outros caem em `rankDefault` (4805–4808) e o merge de rank só reconcilia com `seasonId` igual (3005).
- Foco simultâneo offline em dois dispositivos é subcontado: o merge usa `max` para `days` (3013) e créditos de pontos (3001). É um trade-off; documentar e testar.

### 3. Testes e rede de segurança
- **Não há testes, `package.json`, CI, `.gitignore` nem README.** O núcleo crítico é lógica pura e testável: `bhMergeSync`, `bhSyncPlan`, `bhSyncRankPoints`, `rankReconcileDecay`, `pomoMergeProgress`, `sanitizeHTML`, `bhEmbedCheck/Parse`. Extrair para um módulo e rodar com `node --test`/Vitest, com casos para os cenários do item 2 (IDs duplicados, relógio adiantado, conflito de nota, foco simultâneo). As últimas mudanças (decay retroativo, reembolso de pontos) mexem em regras que afetam os pontos do usuário.
- **Recuperação fora do App.** O `ErrorBoundary` é único (14122) e a tela de erro manda "restaurar um backup na tela Sincronizar" (14132) — mas essa tela está dentro do App que acabou de cair. Se o erro vem de dado persistido, o usuário entra em loop de recarregar. Criar um "modo seguro" que exporte/restaure sem renderizar o App, boundaries por tela e `bhLog` no `componentDidCatch` (hoje só `console.error`).

### 4. Editor de notas
- **O flush ao desmontar não faz nada (plausível).** O cleanup passivo (11209) roda depois que o React zerou a `ref`; `flushSave` vê `ref.current===null` e ainda cancela o timer pendente. A única proteção real é o `onBlur` (11980), que não dispara de forma confiável quando o elemento é removido (voltar do navegador ou gesto de voltar no Android, via popstate em 15353). Perdem-se até 800 ms de digitação. Correção: salvar em um cleanup de `useLayoutEffect`, em que a ref ainda existe.

---

## Prioridade média

### 5. Boot e dependências
- **O splash não é instantâneo.** React, ReactDOM e Lucide são scripts síncronos no `<head>` (47–48, 52) e o CSS do Google Fonts (60) bloqueia a renderização; o splash só pinta depois deles. Sem rede ou com unpkg fora, a tela fica branca. Mover scripts para `defer`/fim do `<body>`, fixar **versão exata** do React (hoje `react@18`) e baixar os 4 scripts Firebase em paralelo (`async=false` mantém a ordem de execução, linha 2808).
- O timeout de 12 s do splash (866) mostra "Erro ao carregar" durante a compilação legítima do Babel em celular lento, na primeira abertura após cada deploy.
- Firebase modular (tree-shaken) no lugar dos 4 `compat`; servir libs do mesmo origin; service worker + `manifest.webmanifest` para offline real (o favicon é descrito como "funciona offline", mas a abertura a frio sem rede falha por causa dos CDNs).
- Mover o WebP de ~200 KB para arquivo estático (ganho pequeno).

### 6. Segurança
- **Pré-compilar o JSX** (Vite com saída single-file) resolve vários problemas de uma vez. Hoje o bundle compilado roda via `new Function` (15817) e é guardado no IndexedDB com a chave exposta em `window.__bhBundleCache.key` (15836): qualquer XSS pode sobrescrever o bundle e persistir a cada boot até a fonte mudar. Pré-compilar elimina isso, o Babel no navegador e o `unsafe-eval`.
- **CSP e SRI só valem depois disso.** Com `unsafe-eval` e scripts inline (61, 864–878 e o loader 15750+, exigindo `unsafe-inline` ou hashes), o `script-src` protege pouco. O ganho imediato da CSP está em `connect-src`, `img-src` e `frame-src`, que limitam vazamento. SRI: fixar `react@18` primeiro; para Firebase e Babel, injetados por JS, é preciso setar `s.integrity` no código.
- **Regras do Firebase não estão no repositório.** Versionar `firestore.rules` e `storage.rules` (limite de tamanho e MIME) e testar com o emulador. Atenção: os links de `getDownloadURL` do Storage (com token) são públicos para quem tiver a URL e não passam pelas regras na leitura, então "segurança depende das regras" não vale para leitura de mídia. Avaliar **App Check**.
- **Fallback para o Imgur.** O consentimento já existe (`_askImgurConsent`, 3696), mas o fallback dispara em qualquer erro do Firebase, inclusive falha transitória de rede (3713–3716), e após o primeiro "sim" a resposta fica guardada na sessão e as próximas imagens vão ao Imgur sem perguntar. Restringir a erros não transitórios e perguntar de novo por upload. O Client-ID fixo (3482) é compartilhado por todos os usuários.
- **Sanitizador (`sanitizeHTML`, 10789)** é híbrido, não só blacklist: allowlist para `class`/`style`, protocolos permitidos para `href`/`src` (10811–10824), remove `svg`, `math`, `template`, `noscript` (vetores de mXSS) e roda na entrada (11099), saída (11195) e colar (11807–11811). Trocar por DOMPurify é desejável, não urgente. Lacunas de risco baixo: `id`/`name` não removidos (DOM clobbering), `target` aceita qualquer valor, `ping`/`srcset`/`poster` passam.
- Uploads: imagens sem limite de tamanho (só GIF e vídeo têm, 3546, 3664–3690); o arquivo inteiro é lido em memória para o SHA-256 (3433), pesado com HEIC grande no celular; SVG é aceito (3501); nenhum objeto do Storage é apagado (órfãos se acumulam).
- `loadFbCfg` (2779) lê uma config do localStorage que nada no app grava: código morto que permite redirecionar o sync para outro projeto Firebase. Remover.

### 7. Manutenibilidade
- **Arquivo único de 1,3 MB.** `App` ≈1.600 linhas (37 `useState`, 32 `useEffect`), `ProjectDetail` ≈1.260, `RichEditor` ≈920, `Gallery` ≈890, `PomodoroTimer` ≈810, `IdeasLab` ≈715, `SyncHub` ≈455; 532 declarações no escopo raiz. O comentário do loader ainda diz "382KB of JSX" (hoje ≈1 MB).
- ~1.150 `style={{…}}` inline e 134 linhas com mais de 300 caracteres (a maior com 1.259, linha 5905). Mover padrões repetidos para classes CSS.
- 118 usos de `localStorage` com chaves próprias espalhadas; centralizar em um módulo `storage` com versionamento de chaves.
- Estado global em `App` com ~30 props passadas às views; `Context` por domínio (projetos, galeria, rank/pomodoro, sync) ou store pequeno.
- Meta de médio prazo: Vite + módulos por domínio (`sync/`, `rank/`, `notes/`, `gallery/`, `projects/`, `ui/`), mantendo saída em `index.html` único com `vite-plugin-singlefile`.

### 8. Acessibilidade (menos grave do que parecia)
- **Já existe:** `useModalLayer` (4044–4080) com trap de Tab, devolução de foco e pilha de Escape; `Modal`, `DialogLayer`, `DialogBox`, `LightboxShell` (4099–4137); `useEscapeLayer` (4086); `prefers-reduced-motion` amplo (linha 835: `.view-enter`, `.overlay`, `.modal`, `.cmd-palette`, `.save-toast`, `.more-sheet`…; o pêndulo ficou de fora de propósito, 504–512). O componente `Field` (2158) envolve o input em `<label>`, usado 24 vezes.
- **O que sobra:** auditar overlays feitos à mão que não usam `useModalLayer`; a paleta de comandos (4259) funciona por teclado mas falta `role="listbox"/"option"` e `aria-activedescendant`; `div`/`span` com `onClick` sem `role`/`tabIndex`/`onKeyDown` (contagem por grep aproximada); `alt` em `<Img>` (confirmar); animação do splash fora do reduced-motion.
- Contraste: `--muted` (#736C67) sobre `--bg` dá 4,58:1 — passa AA por margem mínima e é usado em textos de `.72rem`. Medir também o tema *notturno*.

---

## Prioridade baixa
- `pagehide` global encerra a sessão de foco (6021) em recarregar, navegar ou bfcache (não checa `e.persisted`).
- `enablePersistence(...).catch(()=>{})` (2833) engole a falha de persistência multi-aba; registrar no diagnóstico.
- Dados de exemplo (clientes fictícios, capas hotlinkadas do Unsplash, ~1940–1984) estão no estado padrão; confirmar se aparecem em conta nova e, se sim, trocar por estado vazio com onboarding.
- `<title>` e comentário de cabeçalho com versão manual ("v25"); gerar versão a partir do git e mostrá-la no Sync.
- README com regras Firebase, formato do estado, `boardhubDiagnostics`, backup/restauração e política de dados.
- `key` por índice em listas que reordenam (tiles de imagem com drag-and-drop, 13801); Prettier/ESLint e revisão de cada `eslint-disable`.
- Idioma dos comentários/identificadores misto (PT/EN).

## Descartado após revisão (ruído)
- `localeCompare`: as ordenações de nome/título já usam `'pt-BR', {sensitivity:'base'}`; o resto compara datas ISO ou IDs.
- `type="button"` por padrão: há um único `<form>` no app (11965).
- Dashboard sempre montado (15709): intencional, o Pomodoro vive nele ("timer ativo entre telas", cabeçalho linha 36).
- Criar focus-trap: já existe (item 8).

## O que já está bem feito (manter)
- Salvamento local com detecção de corrupção, backups verificados antes de reset/import, flush em `pagehide`/`visibilitychange`.
- Sync serializado, transações Firestore com merge por ID/campo, isolamento por conta (`assertAccount`), v4 por entidade implementado.
- Allowlist estrita de embeds (host + caminho + HTTPS, com âncoras) e `sandbox` nos iframes; `safeHref` (3728) nos links do JSX.
- Sem `eval`/`document.write`/`alert`; nenhum `innerHTML` com dado remoto sem passar pelo sanitizador.
- Datas consistentes (`localDateISO`, `'T12:00:00'`); objectURLs com LRU e revoke; sem vazamento relevante de listeners/timers encontrado.
- Tema aplicado antes do primeiro paint; cache do bundle compilado com invalidação por hash; 53 `silent-ok` justificados e diagnóstico opt-in.

## Ordem sugerida de execução
1. **Armazenamento local:** `storage.persist()`, evicção/limite no cache de mídia, separar `syncbase`/entidades, acabar com a cópia integral no localStorage, planejar estado primário no IndexedDB.
2. **Tornar o sync v4 o padrão**, com detecção de clientes antigos e testes; política de retenção para `rank.sessions`/`pomoData.days`.
3. **Extrair e testar as funções puras** (merge, rank, decay, sanitizador, embeds), cobrindo IDs duplicados, relógio adiantado, conflito de nota e foco simultâneo.
4. **Editor:** flush em `useLayoutEffect` e conflito de nota que não some sozinho.
5. **Regras Firestore/Storage versionadas**, App Check e revisão do fallback do Imgur.
6. **Modo seguro** de recuperação fora do App e boundaries por tela.
7. **Boot:** `defer`, React fixado, Firebase em paralelo, timeout do splash ciente da compilação.
8. **Pré-compilar o JSX** (Vite single-file); só então SRI e CSP têm valor real.
