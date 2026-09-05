const sections = ['Dashboard','Clientes','Financeiro','Brain','Conhecimento','Aprendizado','OpenAI / Custos','Áudio','WhatsApp / n8n','Auditoria','Health'];
const nav = document.querySelector('#nav');
const view = document.querySelector('#view');
const title = document.querySelector('#title');
const safe = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const card = (label, value, note = '') => `<article class="card"><span class="label">${safe(label)}</span><strong>${safe(value)}</strong><small>${safe(note)}</small></article>`;
const tag = value => `<span class="${['healthy','active','operational','true'].some(x => String(value).toLowerCase().includes(x)) ? 'pill' : 'warn'}">${safe(value)}</span>`;
let liveCache;

sections.forEach((section, index) => {
  const button = document.createElement('button');
  button.className = `nav${index ? '' : ' active'}`;
  button.textContent = section;
  button.onclick = () => render(section, button);
  nav.appendChild(button);
});

async function live(force = false) {
  if (!force && liveCache && Date.now() - liveCache.at < 30000) return liveCache.data;
  const response = await fetch('/api/v1/dashboard');
  if (!response.ok) throw new Error(`Dashboard API: HTTP ${response.status}`);
  const data = await response.json();
  liveCache = {at: Date.now(), data};
  return data;
}

function render(section, button) {
  document.querySelectorAll('.nav').forEach(item => item.classList.remove('active'));
  button?.classList.add('active');
  title.textContent = section === 'Dashboard' ? 'Visão geral' : section;
  if (section === 'Dashboard') dashboard();
  else if (section === 'Brain') brain();
  else if (section === 'Conhecimento') knowledge();
  else if (section === 'Health') health();
  else generic(section);
}

async function dashboard() {
  view.innerHTML = '<div class="grid"><article class="card full"><span class="label">MF24 Brain</span><h2>Consultando produção…</h2></article></div>';
  try {
    const data = await live(true);
    const inventory = data.metrics.inventory;
    const runtime = data.metrics.runtime;
    const system = data.metrics.system;
    const layers = data.metrics.layers;
    view.innerHTML = `<div class="grid">
      <article class="card hero full"><span class="pill">${system.brain_enabled ? 'MF24_BRAIN_ENABLED' : 'BRAIN DESLIGADO'}</span><h2>Inteligência financeira em camadas</h2><p>Estado ao vivo do Brain. O motor nativo resolve primeiro; texto financeiro bruto não é retido e o ledger não é alterado neste painel.</p><div class="layers">${layers.map(layer => `<div class="layer"><i class="dot ${layer.enabled ? '' : 'off'}"></i>${safe(layer.display_name)}<div class="bar"><span style="width:${layer.enabled ? 100 : 0}%"></span></div><small>confiança mínima ${Math.round(Number(layer.min_confidence) * 100)}%</small></div>`).join('')}</div></article>
      ${card('Requisições (24h)', runtime.requests_24h, 'telemetria ao vivo')}
      ${card('Resolvidas sem IA', runtime.resolved_without_ai_24h, 'últimas 24 horas')}
      ${card('Custo IA (24h)', `US$ ${Number(runtime.estimated_ai_cost_usd_24h || 0).toFixed(4)}`, 'estimativa registrada')}
      ${card('Privacidade', system.privacy_mode, system.store_raw_user_text ? 'retenção ativa' : 'sem texto bruto')}
      ${card('Categorias globais', inventory.categories, 'banco Brain')}
      ${card('Entidades', inventory.entities, 'banco Brain')}
      ${card('Aliases', inventory.aliases, 'banco Brain')}
      ${card('Itens de conhecimento', inventory.knowledge_items, 'banco Brain')}
      <article class="card wide"><span class="label">Teste real do Brain</span><h3>Interpretação segura</h3><div class="test"><input id="prompt" maxlength="1000" value="Ontem gastei 180 no mercado e hoje coloquei 100 de gasolina"><button class="primary" id="go">Interpretar</button></div><pre id="out">Nenhum lançamento será gravado. A confirmação continua obrigatória.</pre></article>
      <article class="card wide"><span class="label">Garantias ativas</span><div class="statusline"><span>Brain global</span>${tag(system.brain_enabled ? 'ativo' : 'desligado')}</div><div class="statusline"><span>Aprendizado</span>${tag(system.learning_enabled ? 'ativo' : 'desligado')}</div><div class="statusline"><span>Auto promoção</span>${tag(system.auto_promote_enabled ? 'ativa' : 'desligada')}</div><div class="statusline"><span>Fonte</span><span class="pill">${safe(data.source)}</span></div></article>
    </div>`;
    document.querySelector('#go').onclick = runPreview;
  } catch (error) {
    view.innerHTML = `<div class="grid"><article class="card full"><span class="warn">Produção degradada</span><h2>Não foi possível consultar o Brain</h2><pre>${safe(error.message)}</pre></article></div>`;
  }
}

async function runPreview() {
  const output = document.querySelector('#out');
  const button = document.querySelector('#go');
  button.disabled = true;
  output.textContent = 'Processando no motor nativo e no Brain global…';
  try {
    const response = await fetch('/api/v1/brain/preview', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({text:document.querySelector('#prompt').value})});
    const data = await response.json();
    output.textContent = JSON.stringify(data, null, 2);
  } catch (error) { output.textContent = error.message; }
  finally { button.disabled = false; }
}

async function brain() {
  view.innerHTML = '<div class="grid"><article class="card full">Consultando camadas…</article></div>';
  try {
    const data = await live();
    const system = data.metrics.system;
    view.innerHTML = `<div class="grid"><article class="card hero full"><span class="pill">Kill switch reversível</span><h2>O MF24 continua operando se o Brain for desligado</h2><p>Interpretação → validação → confirmação do usuário → executor autorizado → ledger oficial.</p></article>${data.metrics.layers.map(layer => card(layer.display_name, layer.enabled ? 'ATIVO' : 'INATIVO', `prioridade ${layer.priority} · fallback ${layer.fallback_layer || 'nenhum'}`)).join('')}${card('Aprendizado', system.learning_enabled ? 'ATIVO' : 'INATIVO', system.auto_promote_enabled ? 'auto promoção ativa' : 'auto promoção desligada')}</div>`;
  } catch (error) { showError(error); }
}

async function knowledge() {
  view.innerHTML = '<div class="grid"><article class="card full">Consultando inventário…</article></div>';
  try {
    const {metrics} = await live();
    const i = metrics.inventory;
    view.innerHTML = `<div class="grid"><article class="card hero full"><span class="pill">Banco global isolado</span><h2>Conhecimento reutilizado pelo MF24</h2><p>Apenas métricas agregadas são expostas. Memória particular permanece no projeto oficial do MF24.</p></article>${card('Categorias',i.categories,'globais')}${card('Entidades',i.entities,'normalizadas')}${card('Aliases',i.aliases,'sinônimos')}${card('Regras',i.rules,'determinísticas')}${card('Conhecimento',i.knowledge_items,'itens ativos')}${card('Fontes',i.sources,'registro de origem')}</div>`;
  } catch (error) { showError(error); }
}

async function health() {
  view.innerHTML = '<div class="grid"><article class="card full"><span class="label">Verificação ao vivo</span><h2>Consultando serviços…</h2></article></div>';
  try {
    const [healthResponse, dashboardData] = await Promise.all([fetch('/api/v1/health'), live(true)]);
    const healthData = await healthResponse.json();
    const registry = dashboardData.metrics.services;
    view.innerHTML = `<div class="grid"><article class="card full"><span class="label">API em produção</span><h2>${safe(healthData.status)}</h2>${Object.entries(healthData.services).map(([key,value]) => `<div class="statusline"><span>${safe(key)}</span>${tag(value)}</div>`).join('')}</article><article class="card full"><span class="label">Registro de serviços do Brain</span>${registry.map(service => `<div class="statusline"><span>${safe(service.display_name)}</span>${tag(service.status)}</div>`).join('')}</article></div>`;
  } catch (error) { showError(error); }
}

function generic(section) {
  const mapping = {
    Clientes:['Identidades e espaços','Contas e cartões','Atividade e canais'],
    Financeiro:['Entradas e saídas','Recorrências e parcelas','Filtros administrativos'],
    Aprendizado:['Padrões pendentes','Correções','Conflitos e promoções'],
    'OpenAI / Custos':['Tokens e cache','Custos USD / BRL','Modelos por camada'],
    Áudio:['Transcrições','Duração e latência','Falhas e custos'],
    'WhatsApp / n8n':['Canais vinculados','Idempotência','Mensagens e erros'],
    Auditoria:['Hash da entrada','Camada e confiança','Confirmação e execução'],
  };
  view.innerHTML = `<div class="grid"><article class="card hero full"><span class="pill">Controle administrativo</span><h2>${safe(section)}</h2><p>Dados particulares são consultados no mínimo necessário e nunca promovidos automaticamente ao conhecimento global.</p></article>${(mapping[section] || []).map(item => card(item,'—','aguardando eventos reais')).join('')}</div>`;
}

function showError(error) {
  view.innerHTML = `<div class="grid"><article class="card full"><span class="warn">Falha na consulta</span><pre>${safe(error.message)}</pre></article></div>`;
}

dashboard();
