/**
 * Ejecuta el workflow real de n8n nodo por nodo contra el backend vivo.
 *
 * Lee whatsapp-main.json y recorre el grafo igual que n8n: evalúa los Code
 * nodes, resuelve las expresiones {{ }} y hace las llamadas HTTP de verdad.
 * Lo único que no es real es el nodo de Claude, que se sustituye por una
 * respuesta con la forma exacta que devuelve la API de Anthropic (no hay
 * API key en este entorno).
 *
 * Sirve para verificar el contrato workflow <-> backend: URLs, headers,
 * nombres de campos y ramas del switch.
 */
const fs = require('fs');

const WF = JSON.parse(
  fs.readFileSync(require('path').join(__dirname, '../../n8n/workflows/whatsapp-main.json'), 'utf8')
);

// Se lee en cada acceso: el puerto lo fija el test en beforeAll, despues de
// que este modulo ya fue importado.
const ENV = new Proxy({}, {
  get(_, k) {
    if (k === 'BACKEND_URL') return process.env.WF_BACKEND_URL || 'http://localhost:3000';
    if (k === 'N8N_API_KEY') return process.env.N8N_API_KEY || 'test-n8n-key';
    if (k === 'ANTHROPIC_API_KEY') return 'no-hay-key';
    return undefined;
  },
});

const node = (name) => {
  const n = WF.nodes.find((x) => x.name === name);
  if (!n) throw new Error('No existe el nodo: ' + name);
  return n;
};
const nextOf = (name, output = 0) =>
  (WF.connections[name]?.main?.[output] ?? []).map((c) => c.node);

// --- Motor de expresiones de n8n ---------------------------------------------
// Resuelve "={{ expr }}" con acceso a $json, $env y $('Nodo').
function evalExpr(raw, ctx) {
  if (typeof raw !== 'string' || !raw.startsWith('=')) return raw;
  const body = raw.slice(1);
  const $ = (n) => ({ item: { json: ctx.results[n] } });
  const render = (expr) =>
    new Function('$json', '$env', '$', `return (${expr});`)(ctx.json, ENV, $);

  // Expresión única que ocupa todo el valor -> conserva el tipo
  const solo = body.match(/^\{\{([\s\S]+)\}\}$/);
  if (solo) return render(solo[1]);
  // Interpolación dentro de texto
  return body.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => String(render(e)));
}

function runCode(n, ctx) {
  const $ = (name) => ({ item: { json: ctx.results[name] } });
  const $input = { item: { json: ctx.json } };
  const out = new Function('$', '$input', '$json', 'console', n.parameters.jsCode)(
    $, $input, ctx.json, { log: (...a) => ctx.logs.push(a.join(' ')) }
  );
  return out;
}

async function runHttp(n, ctx) {
  const url = evalExpr(n.parameters.url, ctx);
  const headers = {};
  for (const h of n.parameters.headerParameters?.parameters ?? []) {
    headers[h.name] = evalExpr(h.value, ctx);
  }
  let body;
  if (n.parameters.sendBody) {
    body = evalExpr(n.parameters.body, ctx);
    headers['content-type'] = headers['content-type'] ?? 'application/json';
  }

  ctx.calls.push({ method: n.parameters.method, url, headers, body });

  // El nodo de Claude no se puede llamar de verdad: sin API key.
  if (url.includes('api.anthropic.com')) {
    return { __stub: 'claude', ...ctx.claudeStub };
  }

  // Un fallo de red (DNS, conexion rechazada, timeout) es un error de nodo en
  // n8n, igual que un status !=2xx: con onError continueRegularOutput deja
  // pasar un item de error, y sin el corta el workflow. Modelar solo el status
  // fue lo que dejo pasar el bug del DNS.
  let res;
  try {
    res = await fetch(url, { method: n.parameters.method, headers, body });
  } catch (err) {
    ctx.calls[ctx.calls.length - 1].status = 'ERR';
    if (n.onError !== 'continueRegularOutput') {
      throw new Error(`${n.name}: ${err.message}`);
    }
    return { error: { message: err.message, name: 'NodeApiError' } };
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  ctx.calls[ctx.calls.length - 1].status = res.status;

  if (!res.ok && n.onError !== 'continueRegularOutput') {
    throw new Error(`${n.name}: HTTP ${res.status} ${text.slice(0, 120)}`);
  }
  return res.ok ? json : { error: json };
}

function runIf(n, ctx) {
  const c = n.parameters.conditions.conditions[0];
  const left = evalExpr(c.leftValue, ctx);
  const op = c.operator;
  switch (op.operation) {
    case 'notEmpty': return left !== '' && left !== null && left !== undefined;
    case 'empty':    return left === '' || left === null || left === undefined;
    case 'notEquals': return left !== c.rightValue;
    case 'equals':   return left === c.rightValue;
    case 'true':     return Boolean(left);
    case 'false':    return !left;
    default:
      throw new Error('Operador no soportado: ' + JSON.stringify(op));
  }
}

function runSwitch(n, ctx) {
  const reglas = n.parameters.rules.values;
  for (let i = 0; i < reglas.length; i++) {
    const c = reglas[i].conditions.conditions[0];
    if (evalExpr(c.leftValue, ctx) === c.rightValue) return i;
  }
  return reglas.length; // fallback
}

// --- Recorrido del grafo ------------------------------------------------------
async function runWorkflow(webhookBody, claudeStub) {
  const ctx = {
    json: { body: webhookBody },
    results: { Webhook: { body: webhookBody } },
    calls: [],
    logs: [],
    claudeStub,
  };

  let actual = nextOf('Webhook')[0];
  let reply = null;
  const camino = ['Webhook'];
  let pasos = 0;

  while (actual && pasos++ < 40) {
    const n = node(actual);
    camino.push(actual);
    let salida = 0;

    if (n.type === 'n8n-nodes-base.code') {
      const out = runCode(n, ctx);
      // Un Code node puede emitir varios items (auditoría: entrante+saliente).
      if (Array.isArray(out)) {
        ctx.items = out.map((i) => i.json ?? i);
        ctx.json = ctx.items[0] ?? {};
      } else {
        ctx.items = null;
        ctx.json = out;
      }
      ctx.results[actual] = ctx.json;
    } else if (n.type === 'n8n-nodes-base.httpRequest') {
      // n8n ejecuta el nodo una vez por cada item de entrada.
      if (ctx.items && ctx.items.length) {
        const salidas = [];
        for (const item of ctx.items) {
          ctx.json = item;
          salidas.push(await runHttp(n, ctx));
        }
        ctx.items = null;
        ctx.json = salidas[0];
      } else {
        ctx.json = await runHttp(n, ctx);
      }
      ctx.results[actual] = ctx.json;
    } else if (n.type === 'n8n-nodes-base.if') {
      salida = runIf(n, ctx) ? 0 : 1;
    } else if (n.type === 'n8n-nodes-base.switch') {
      salida = runSwitch(n, ctx);
    } else if (n.type === 'n8n-nodes-base.respondToWebhook') {
      reply = ctx.json.reply;
      ctx.results[actual] = ctx.json;
    }

    actual = nextOf(actual, salida)[0];
  }

  return { reply, camino, calls: ctx.calls, logs: ctx.logs };
}

// Respuesta con la forma exacta de la API de Anthropic
const claude = (intent, entities = {}) => ({
  stop_reason: 'end_turn',
  content: [{
    type: 'text',
    text: JSON.stringify({
      intent,
      entities: { plate: null, customerName: null, serviceKeyword: null, ...entities },
    }),
  }],
});

module.exports = { runWorkflow, claude, WF };
