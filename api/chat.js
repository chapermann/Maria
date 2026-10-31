const nodemailer = require('nodemailer');
const MODEL = 'claude-sonnet-5-5';   // alternativa mais econômica: 'claude-haiku-5-5'
const CEP_CONSULTORIO = '22010122';
const LINK = 'https://saudedireta.com.br/iclin/aol/agendas.php?c=128187';
const MAX_MSGS = 40, MAX_LEN = 1500, MAX_POR_HORA = 60;

const SYS = `Você é a MarIA, secretária executiva virtual do Dr. Fernando José Chapermann (CRM-RJ 817163, Clínica Médica e Infectologia), da empresa FM2R Serviços Médicos, atendendo visitantes do site dele. Português do Brasil, tom profissional, acolhedor e eficiente; respostas curtas (no máximo 5 linhas), sem markdown e sem asteriscos.
Objetivo: atender bem, coletar os dados necessários e conduzir, com educação, ao agendamento (presencial ou domiciliar). Nunca invente informações; se não souber, diga que vai verificar com o Dr. Fernando. Você não dá orientação médica, diagnóstico nem prescrição; diante de sinais de urgência, oriente SAMU 192 ou pronto-socorro.
DADOS: atendimento somente particular (sem planos de saúde); sem emergência. Consultório: Av. Nossa Senhora de Copacabana, 1066, sala 1102, Copacabana, Rio de Janeiro, CEP 22010-122. Presencial somente às terças-feiras (manhã, tarde ou noite). Consulta R$ 450,00 (válido até 31/12/2026). Agendamento online: ${LINK}. WhatsApp (21) 98893-4020. E-mail chapermann@gmail.com. Chave PIX: 22.653.819/0001-90 (aparece FM2R Serviços Médicos).
O menu inicial (1 Agendar consulta, 2 Pré-agendamento, 3 Confirmar consulta, 4 Cancelar consulta, 5 Atendimento domiciliar, 6 Outro assunto) já foi exibido; não o repita.
FLUXOS:
1 Agendar: envie o link de agendamento online e ofereça o pré-agendamento como alternativa.
2 Pré-agendamento: informe que presencial é só às terças; pergunte o turno (manhã/tarde/noite); colete, aos poucos: nome completo, CPF, data de nascimento, e-mail, WhatsApp, telefone (se diferente), endereço completo (rua, número, bairro, CEP, cidade). Ao final, confirme o recebimento e diga que a confirmação seguirá por e-mail e WhatsApp em até 24 horas.
3 Confirmar: peça nome completo e data aproximada; diga que vai verificar e confirmar.
4 Cancelar: peça nome completo e data da consulta; diga que o cancelamento será registrado e confirmado.
5 Domiciliar: colete nome completo, CPF, data de nascimento, e-mail, WhatsApp, telefone (se diferente) e endereço completo com CEP. Só depois de ter TODOS os dados, chame a ferramenta calcular_orcamento_domiciliar com o CEP do paciente. Se a ferramenta devolver o valor, responda: "Obrigada pelas informações. O valor do atendimento domiciliar para o endereço informado é R$ XXX,XX. Deseja confirmar o agendamento?". Se devolver erro, diga que o consultório enviará o orçamento em breve. NUNCA mencione fórmula, tarifa-base ou valor por quilômetro, e nunca informe valor do domiciliar sem a ferramenta.
6 Outro assunto: ofereça (a) atualizar receitas (peça nome completo e CPF), (b) dúvidas com o Dr. Fernando (peça que escreva a dúvida), (c) questões financeiras (envie a chave PIX e diga que aparece FM2R Serviços Médicos), (d) recibo médico (peça nome, CPF, e-mail e telefone).
Peça um ou dois dados por vez. Sempre que possível, ofereça o link de agendamento ou o WhatsApp.
RESUMO: quando tiver todos os dados de um fluxo, confirme o recebimento, diga que as informações serão encaminhadas ao consultório e termine com um bloco em linha separada: [[RESUMO]]tipo de solicitação e todos os dados coletados em texto simples (no domiciliar, inclua CEP de origem 22010-122, CEP de destino, distância em km e valor calculado)[[/RESUMO]]. Não use esse bloco em nenhum outro momento.`;

const TOOLS = [{
  name: 'calcular_orcamento_domiciliar',
  description: 'Calcula o orçamento do atendimento domiciliar a partir do CEP do paciente. Use somente após coletar todos os dados do paciente.',
  input_schema: { type: 'object', properties: { cep_paciente: { type: 'string', description: 'CEP do local do atendimento' } }, required: ['cep_paciente'] }
}];

const visitas = new Map();
function limite(ip) {
  const agora = Date.now();
  let r = visitas.get(ip);
  if (!r || agora - r.t > 3600e3) r = { n: 0, t: agora };
  r.n++; visitas.set(ip, r);
  return r.n <= MAX_POR_HORA;
}

function achar(o, chave) {
  if (o && typeof o === 'object') {
    if (chave in o) return o[chave];
    for (const k in o) { const v = achar(o[k], chave); if (v != null) return v; }
  }
  return null;
}

async function orcamento(cep) {
  const tok = process.env.APIBRASIL_TOKEN;
  cep = String(cep || '').replace(/\D/g, '');
  if (!tok) return { erro: 'servico_indisponivel' };
  if (cep.length !== 8) return { erro: 'cep_invalido' };
  try {
    const r = await fetch('https://gateway.apibrasil.io/api/v2/cep/distancia/calcular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ tipo: 'calcula-distancia-cep', ceps: [CEP_CONSULTORIO, cep], mode: 'driving' })
    });
    const raw = Number(achar(await r.json(), 'distanceRaw'));
    if (!raw || isNaN(raw)) return { erro: 'falha_no_calculo' };
    const km = raw / 1000;
    const valor = Math.round((900 + km * 10) * 100) / 100;
    return { distancia_km: Math.round(km * 100) / 100, valor_reais: valor.toFixed(2).replace('.', ',') };
  } catch (e) { return { erro: 'falha_no_calculo' }; }
}

async function rodar(msgs) {
  const conv = msgs.slice();
  for (let i = 0; i < 4; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system: SYS, tools: TOOLS, messages: conv })
    });
    if (!r.ok) throw new Error('API ' + r.status + ' ' + (await r.text()).slice(0, 300));
    const d = await r.json();
    if (d.stop_reason === 'tool_use') {
      conv.push({ role: 'assistant', content: d.content });
      const res = [];
      for (const x of d.content.filter(c => c.type === 'tool_use')) {
        const out = x.name === 'calcular_orcamento_domiciliar' ? await orcamento(x.input.cep_paciente) : { erro: 'ferramenta_desconhecida' };
        res.push({ type: 'tool_result', tool_use_id: x.id, content: JSON.stringify(out) });
      }
      conv.push({ role: 'user', content: res });
      continue;
    }
    return d.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  }
  return 'Desculpe, tive uma instabilidade. Pode repetir, por favor?';
}

async function registrar(resumo, msgs, ultima) {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const md = '# Conversa com a MarIA · ' + agora + '\n\n## Resumo\n\n' + resumo + '\n\n## Transcrição\n\n' +
    msgs.map(m => '**' + (m.role === 'user' ? 'Paciente' : 'MarIA') + ':** ' + m.content).join('\n\n') +
    '\n\n**MarIA:** ' + ultima + '\n';
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  await t.sendMail({
    from: '"MarIA" <' + process.env.GMAIL_USER + '>',
    to: process.env.DESTINO || process.env.GMAIL_USER,
    subject: 'MarIA · nova solicitação · ' + agora,
    text: resumo + '\n\n(Transcrição completa em anexo.)',
    attachments: [{ filename: 'conversa-' + Date.now() + '.md', content: md, contentType: 'text/markdown' }]
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).json({ status: 'MarIA no ar' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
    if (!limite(ip)) return res.status(429).json({ error: 'limite' });
    let msgs = Array.isArray(b.messages) ? b.messages.slice(-MAX_MSGS) : [];
    msgs = msgs.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
               .map(m => ({ role: m.role, content: m.content.slice(0, MAX_LEN) }));
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'requisicao_invalida' });

    let texto = await rodar(msgs);
    const m = texto.match(/\[\[RESUMO\]\]([\s\S]*?)\[\[\/RESUMO\]\]/);
    texto = texto.replace(/\[\[RESUMO\]\][\s\S]*$/, '').trim();
    let enviado = false;
    if (m && !b.resumoEnviado) { await registrar(m[1].trim(), msgs, texto); enviado = true; }
    return res.status(200).json({ reply: texto, resumoEnviado: enviado });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'falha' });
  }
};
