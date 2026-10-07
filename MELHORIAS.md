# BoardHub — análise do código e melhorias possíveis

Análise de `index.html` (commit `6ba6918`, out/2026). Tudo vive em um único arquivo de ~1,3 MB, sem build: ~97 KB de CSS, ~14,9 mil linhas / ~1 MB de JSX compilado no navegador, mais uma imagem WebP de ~200 KB em base64 (linha 881). Os números abaixo vêm de `grep`/leitura direta; os que são estimativas estão marcados.

**Resumo:** o app é cuidadoso nos pontos mais perigosos (persistência, backup, sync transacional, sanitização, allowlist de embeds). Os maiores riscos são **manutenibilidade** (um arquivo de 1,3 MB, componentes de mais de 1.000 linhas, zero testes), **dependência de CDNs sem pinagem/SRI/CSP**, e **limites estruturais do sync** (documentos Firestore ~1 MB). Acessibilidade e performance de boot são os próximos.

---

## Prioridade alta

### 1. Segurança e supply chain
- **React sem versão fixa**: `react@18` e `react-dom@18` (linhas 47–48) resolvem para o último 18.x do unpkg. Fixar a versão exata (como já é feito com Lucide, Babel e Firebase).
- **Nenhum `integrity=` (SRI) e nenhuma Content-Security-Policy.** Todo o código roda com acesso total ao `localStorage`, ao IndexedDB e à sessão Firebase; se unpkg ou gstatic forem comprometidos, tudo (notas, clientes, tokens) é exposto. Adicionar SRI nos scripts e uma CSP via `<meta>` (ou header, se hospedar em algo que permita) restringindo `script-src`, `connect-src` e `frame-src` aos hosts já usados. Obs.: a CSP precisará de `'unsafe-eval'` enquanto o bundle for compilado com `new Function` no navegador — mais um motivo para o item 5.
- **Regras do Firebase não estão no repositório.** O comentário do topo diz que `request.auth.uid == userId` é obrigatório, mas nada garante isso. Versionar `firestore.rules` e `storage.rules` (com limite de tamanho e MIME) e testá-las com o emulador. A `apiKey` no código (linha 2785) é pública por design, então a segurança depende 100% dessas regras.
- **Client-ID do Imgur fixo no código (linha 3482) como fallback de upload.** Imagens enviadas por esse caminho ficam em um serviço de terceiros, em URL pública não listada, e o limite de requisições é compartilhado por todos que usam o app. Decidir se esse fallback deve continuar; se sim, avisar o usuário na hora do upload que a imagem sai do seu storage.
- **Sanitizador de HTML feito à mão** (`sanitizeHTML`, linha 10789) usa lista de tags *proibidas* (`script,style,iframe…`) em vez de lista de tags *permitidas*. Está bem feito para o que cobre (remove `on*`, `srcdoc`, protocolos perigosos, estilos colados), mas qualquer tag/atributo novo do navegador passa por padrão. Trocar por DOMPurify com allowlist, ou inverter a lógica para allowlist. Atributos como `srcset`/`poster` não são filtrados (rastreamento por imagem remota vinda de nota sincronizada — risco baixo).
- IDs gerados com `Date.now()` + `Math.random()` (17 ocorrências de `id:Date.now()…` e 16 usos de `Math.random`, nem todos para IDs). Colisão é improvável, mas `crypto.randomUUID()` resolve de vez e simplifica o merge por ID do sync.

### 2. Testes e rede de segurança
- **Não há nenhum teste, `package.json`, CI, `.gitignore` ou README.** Os trechos mais críticos são lógica pura e fáceis de testar: `bhMergeSync`, `bhSyncPlan`, `sanitizeHTML`, `bhEmbedParse/Check`, `rankReconcileDecay`, `pomoMergeProgress`, `bhMigrateProjectFocusPosts`. As últimas mudanças (decay retroativo, reembolso de pontos) mexem em regras de negócio com dinheiro-de-pontos do usuário e se beneficiariam muito de testes.
- Extrair essas funções puras para um módulo e rodar com `node --test` ou Vitest. Incluir um workflow de GitHub Actions que ao menos faça *lint* e rode os testes.
- **Um único `ErrorBoundary` global** (linha 14122) envolve o app inteiro: um erro de renderização em qualquer tela (por exemplo, uma nota com HTML estranho) derruba tudo. Colocar um boundary por view (`Gallery`, `ProjectDetail`, `IdeasLab`…) com botão "tentar de novo", e logar o erro no diagnóstico já existente.

### 3. Manutenibilidade da base de código
- **Arquivo único de 1,3 MB.** Componentes enormes: `App` ≈1.600 linhas (37 `useState`, 32 `useEffect`), `ProjectDetail` ≈1.260, `RichEditor` ≈920, `Gallery` ≈890, `PomodoroTimer` ≈810, `IdeasLab` ≈715, `SyncHub` ≈455. Há 532 declarações no nível raiz num único escopo, e comentário do loader ainda diz "382KB of JSX" (hoje ≈1 MB), sinal de que a documentação interna envelheceu.
- **~1.150 `style={{…}}` inline** no JSX e 134 linhas com mais de 300 caracteres (a maior tem 1.259, linha 5905). Isso dificulta revisão e diffs, impede reutilização e força o React a recriar objetos de estilo a cada render. Mover os padrões repetidos para classes CSS (já existe um sistema de tokens `--bg`, `--muted`, etc.).
- **Meta de médio prazo:** passar para um projeto com build (Vite + React), dividir em módulos (`sync/`, `rank/`, `notes/`, `gallery/`, `projects/`, `ui/`) e manter a saída final como um `index.html` único se a portabilidade for importante (`vite-plugin-singlefile`). Isso elimina de uma vez o Babel no navegador, o cache de bundle em IndexedDB, o problema de CSP e o `eval`-equivalente.
- Estado global em `App` com ~30 props sendo passadas para cada view. Um `Context` por domínio (projetos, galeria, rank/pomodoro, sync) ou um store pequeno (Zustand) reduz o *prop drilling* e re-renders desnecessários.
- Persistência espalhada: 118 referências diretas a `localStorage` com chaves próprias (`GT_EXPANDED_KEY`, `GT_WEEK_KEY`, `BH_SESSION_LINK_KEY`, `boardhub_theme`…). Centralizar em um único módulo `storage` com versionamento de chaves.

---

## Prioridade média

### 4. Sync e dados
- **Teto de ~1 MB por documento.** O push recusa seções acima de 950.000 bytes (linha 3325) e o cabeçalho do arquivo admite que `notes` e `gallery` ainda são arrays dentro de um documento. Para um usuário que cresce, isso vira bloqueio de sync. Já existe um caminho de migração para entidades (`bhEntityModes`, `onMigrateEntities`); concluí-lo e torná-lo padrão é o item de maior retorno estrutural no sync.
- **Clone profundo do estado inteiro** via `JSON.parse(JSON.stringify(state))` a cada push (linha 3274) e a cada backup (linha 1820). Com estado de vários MB, isso trava telefones — o próprio código já reconhece isso (comentário na linha 1087 sobre o checkpoint de 5 s). Usar `structuredClone` ou, melhor, só clonar as seções sujas (o plano de diff `bhSyncPlan` já as identifica).
- Sem número de versão de schema centralizado: há `_v:'3.4'` só no documento remoto. Definir uma constante de versão local com migrações explícitas e testadas.
- `enablePersistence(...).catch(()=>{})` (linha 2827) engole a falha de persistência multi-aba sem avisar ninguém. Pelo menos registrar no diagnóstico.
- Dados de exemplo (clientes fictícios, capas hotlinkadas do Unsplash — linhas ~1940–1970) estão no estado padrão. Confirmar se aparecem para contas novas; se sim, trocar por estado vazio com onboarding, para não depender de URLs externas nem poluir dados reais.

### 5. Performance de boot
- **Cold start depende de 4 CDNs/hosts**: unpkg (React, ReactDOM, Lucide, Babel) e gstatic (4 scripts Firebase carregados em sequência, linhas 2802–2805). Em cache miss, o Babel (~400 KB) é baixado *depois* da consulta ao IndexedDB, e o JSX de ~1 MB é transpilado no dispositivo.
- Ganhos concretos: (a) pré-compilar o JSX (item 3); (b) trocar os scripts Firebase por um único bundle modular (`firebase/app` + `auth` + `firestore` modular, tree-shaken) em vez dos 4 `compat`; (c) servir React/Lucide do mesmo origin; (d) `defer`/`async` onde possível.
- **Sem service worker nem manifest.** O favicon é descrito como "funciona offline", mas uma abertura a frio sem rede falha por causa dos CDNs. Um service worker simples (cache do `index.html` e das libs) mais `manifest.webmanifest` dá offline real e instalação como PWA.
- O `Dashboard` fica sempre montado (escondido com `display:contents/none`, linha 15709) enquanto as outras telas desmontam. Se for intencional (timer/estado), documentar; se não, ele roda efeitos e re-renders mesmo fora de vista.
- Imagem base64 de ~200 KB embutida no HTML (linha 881) engorda o parse inicial; mover para um arquivo estático cacheável.

### 6. Acessibilidade
- Foco e teclado: há 218 `aria-*` e 17 tratamentos de `Escape`, mas só 9 `aria-modal` e **nenhum helper de focus-trap** encontrado; modais deixam o foco escapar para o fundo. Criar um `useFocusTrap` e um componente `Modal` único (devolve foco ao gatilho ao fechar).
- **Formulários:** 22 `<label>` e apenas 1 `htmlFor` para ~70 `<input>`. Associar rótulos (ou `aria-label`) em todos os campos.
- Elementos clicáveis não-semânticos: há `<div onClick>`/`<span onClick>` (por exemplo, itens da paleta de comandos, linha 4259) sem `role`/`tabIndex`/`onKeyDown`. *(Contagem por grep, aproximada: o regex corta em `=>`.)* Trocar por `<button>` ou adicionar role + teclado.
- Muitos `<button>` sem `type` (contagem aproximada pelo mesmo motivo). Dentro de `<form>` isso causa submits acidentais; definir `type="button"` por padrão em um componente `Button`.
- Contraste: `--muted` (#736C67) sobre `--bg` dá 4,58:1 — passa AA por margem mínima e é usado em textos de `.72rem`. Escurecer um pouco. Medir também o tema *notturno*. Bordas (`--border` 1,13:1) são decorativas; `--field-border` está ok (3,28:1).
- `prefers-reduced-motion` só cobre a promoção de rank e o `scroll-behavior`. Estender para splash, `view-enter`, partículas e demais animações.
- Revisar `alt` em `<Img>` (a contagem por grep sugere que a maioria não passa `alt`; confirmar) e `title` em iframes de embed (já existe: "Conteúdo incorporado" — personalizar por provedor).

### 7. Internacionalização e consistência
- Idioma misturado no código: UI em português, comentários e identificadores em inglês e português (`handleCloseNewProject`, `bhFlushPendingEdits`, "Mídia não portátil detectada"). Escolher um idioma para comentários/identificadores.
- `localeCompare` usado 21 vezes sem locale (todas ordenam sem `'pt-BR'`), então a ordenação de nomes com acentos depende do idioma do navegador. Passar `'pt-BR'` (ou um `Intl.Collator` compartilhado, mais rápido em listas grandes).
- Textos da interface hardcoded em JSX; se um dia houver outro idioma, extrair para um dicionário.

---

## Prioridade baixa / polimento
- `<title>` e comentário de cabeçalho com versão manual ("v25"); gerar a versão a partir do git/CHANGELOG e mostrá-la na tela de Sync para facilitar suporte.
- Documentar em um README: como abrir, regras Firebase necessárias, formato do estado, como usar `boardhubDiagnostics`, estratégia de backup/restauração e política de dados.
- Usar índices como `key` em 6 listas (linhas 4259, 11925, 11927, 12870, 13676, 13801) — trocar por IDs estáveis onde a lista reordena (ex.: tiles de imagem com drag-and-drop, linha 13801).
- Preferir `rel="noopener noreferrer"` automático via componente de link (hoje o sanitizador adiciona para notas; confirmar no restante do JSX — nenhum `target="_blank"` sem `noopener` foi achado por grep).
- Padronizar formatação com Prettier e ESLint (`react-hooks/exhaustive-deps` já aparece desabilitado em pontos, como na linha ~15240; revisar cada `eslint-disable`).

---

## O que já está bem feito (manter)
- Salvamento local com detecção de corrupção, backups verificados antes de reset/import, histórico em IndexedDB e flush em `pagehide`/`visibilitychange`.
- Sync serializado por fila, transações Firestore com merge por ID/campo, isolamento por conta (`assertAccount`) e limite de tamanho com dados locais preservados.
- Allowlist estrita de provedores de embed (`BH_EMBED_ALLOW`) com validação de host, caminho e HTTPS, e `sandbox` nos iframes.
- Ausência de `eval`, `document.write` e de `alert/prompt` (diálogos próprios, `ConfirmHost`).
- Tratamento explícito de falhas silenciosas (53 marcações `silent-ok` justificadas) e diagnóstico opt-in.
- Tema aplicado antes do primeiro paint (sem flash) e cache do bundle compilado com invalidação por hash.

## Ordem sugerida de execução
1. Fixar React, SRI, CSP e versionar as regras Firebase (1–2 h, risco baixo).
2. Error boundaries por view + extrair e testar as funções puras de sync/rank/sanitização (1–2 dias).
3. `Modal` único com focus-trap, labels nos inputs e `type="button"` padrão (1 dia).
4. Service worker + manifest, Firebase modular, mover o WebP para arquivo (meio dia).
5. Migrar para Vite com saída single-file e modularizar por domínio (incremental, uma tela por vez).
6. Concluir a migração por entidades do Firestore para remover o teto de ~1 MB.
