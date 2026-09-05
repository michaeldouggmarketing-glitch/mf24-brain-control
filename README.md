# MF24 Brain Control Center

Projeto independente para controle, API e observabilidade da inteligência do MF24. O ledger continua exclusivamente em `meu-financeiro-24h-prod`; conhecimento e telemetria vivem no schema isolado `mf24_brain` de `aqualax-command-prod`.

## Fluxo real

`MF24 nativo → memória particular → conhecimento global → OpenAI econômica → OpenAI avançada → validação → confirmação → executor autorizado → ledger oficial MF24`

A OpenAI é fallback/amplificador. Casos conhecidos continuam no motor nativo e no banco global para economizar tokens e preservar previsibilidade. A integração usa Responses API com saída estruturada, `store: false` e confirmação obrigatória.

Defaults atuais do projeto:

- IA econômica: `gpt-5.6-luna`
- IA avançada: `gpt-5.6-terra`
- áudio/transcrição: `gpt-4o-mini-transcribe`

Os nomes continuam configuráveis por ambiente; não ficam presos ao código.

## API

- `GET /api/v1/health`
- `GET /api/v1/dashboard` — somente status e métricas agregadas
- `GET /api/v1/admin/snapshot` — leitura administrativa ao vivo de MF24 PROD + Brain, protegida por `X-Admin-Key`
- `GET /api/v1/identity` — somente claims não secretos do OIDC da Vercel
- `POST /api/v1/brain/preview` — sem escrita no ledger; teste público seguro do painel
- `POST /api/v1/brain/interpret` — orquestra as quatro camadas
- `POST /api/v1/channels/whatsapp/message` — idempotência + vínculo obrigatório do telefone ao MF24
- `POST /api/v1/audio/transcribe` — transcrição no servidor + orquestração completa

Endpoints operacionais exigem `Authorization: Bearer <key>` ou `X-API-Key`. Chaves são comparadas por hash no servidor e nunca são armazenadas no repositório.

A área administrativa usa um guard separado (`MF24_ADMIN_TOKEN_HASH`). O token digitado no painel fica somente em `sessionStorage` no navegador e não é retornado por nenhuma API.

## Variáveis de ambiente

Obrigatórias para produção completa:

- `OPENAI_API_KEY`
- `MF24_API_KEY_HASH`
- `MF24_ADMIN_TOKEN_HASH`
- `MF24_BRAIN_SERVICE_ROLE_KEY`
- `MF24_PROD_SERVICE_ROLE_KEY`

Configuração:

- `MF24_BRAIN_ENABLED=true`
- `MF24_BRAIN_URL`
- `MF24_BRAIN_PROJECT_URL`
- `MF24_BRAIN_PUBLISHABLE_KEY`
- `MF24_PROD_URL`
- `MF24_ECONOMY_MODEL=gpt-5.6-luna`
- `MF24_ADVANCED_MODEL=gpt-5.6-terra`
- `MF24_AUDIO_MODEL=gpt-4o-mini-transcribe`
- `MF24_ALLOWED_ORIGINS`
- `MF24_MAX_AUDIO_BYTES`
- `MF24_MAX_AUDIO_SECONDS`
- `MF24_N8N_WEBHOOK_URL` quando o fluxo n8n for ligado

Sem `OPENAI_API_KEY`, o Brain permanece funcional nas camadas nativa/global e sinaliza IA como não configurada. Sem service roles, operações privilegiadas permanecem bloqueadas em vez de degradarem para acesso inseguro.

## Privacidade e fonte da verdade

O MF24 PROD continua sendo a única fonte oficial para dados particulares e ledger. O snapshot administrativo devolve apenas agregados; não devolve descrições, mensagens, payloads pessoais ou texto financeiro bruto. O Brain global não recebe memória particular do usuário.

Respostas da OpenAI são processadas com `store: false`. Telemetria registra hashes, camada, modelo, tokens, custo estimado, latência e sucesso — não o texto financeiro bruto.

## Áudio

`POST /api/v1/audio/transcribe` aceita JSON com `audio_url` HTTPS ou `audio_base64`, `mime_type`, `duration_ms`, `filename` e `channel`. O arquivo é validado, limitado, transcrito no servidor e descartado. O texto transcrito segue o mesmo orquestrador e nunca grava diretamente no ledger.

## WhatsApp / n8n

Envie `event_id`, `phone`, `message_type`, `text` ou `audio_url`, e `timestamp`. Reutilize o mesmo `event_id` em retries.

Antes de interpretar, o endpoint:

1. valida timestamp e janela contra replay;
2. reivindica a chave de idempotência;
3. transforma o telefone em SHA-256;
4. resolve esse hash em `mf24_brain.channel_links` por RPC disponível apenas a `service_role`;
5. rejeita um número que ainda não esteja vinculado a um usuário/espaço MF24;
6. interpreta, mas não grava no ledger.

A migration `20260905144000_add_mf24_brain_channel_link_resolver.sql` implementa a resolução service-only.

## Painel

Dashboard, Brain, Conhecimento e Health usam métricas públicas agregadas. Clientes, Financeiro, Aprendizado, OpenAI/Custos, Áudio, WhatsApp/n8n e Auditoria passam por `/api/v1/admin/snapshot`, com autenticação administrativa separada e leitura real dos dois projetos.

## Segurança

Segredos somente no ambiente; CSP/cabeçalhos defensivos; payload limitado; rate limit; idempotência; hash de telefone/entrada; confirmação obrigatória; zero retenção de áudio bruto; RLS nas tabelas do Brain; RPC de vínculo de canal revogado para `public`, `anon` e `authenticated`.

## Testes e CI

```bash
npm test
npm run build
```

GitHub Actions executa ambos em cada push/PR para `main`.
