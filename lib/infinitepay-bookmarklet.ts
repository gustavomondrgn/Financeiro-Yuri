import 'server-only'
import { env } from '@/lib/env'

/**
 * Atalho de navegador que captura o access token da InfinitePay.
 *
 * O painel manda `Authorization` em toda chamada para a API dele. Em vez de
 * caçar isso no DevTools, o atalho envolve `fetch` e `XMLHttpRequest` e lê o
 * header quando ele passa — o token nunca precisa ser copiado à mão.
 *
 * Como o painel renova o token sozinho a cada 30 minutos, deixar a aba aberta
 * mantém o sistema alimentado: cada token novo é enviado assim que aparece.
 *
 * Também manda a URL onde o token foi visto. É assim que a rota de renovação
 * vai aparecer: quando um token novo chegar, o `origem` diz qual chamada o
 * trouxe — e aí o sync de hora em hora pode deixar de depender de aba aberta.
 *
 * Não guarda nada, não lê senha, não toca em cookie: só observa um header que
 * a própria página já está enviando, e repassa para o nosso domínio.
 */
export function buildBookmarklet(appUrl: string): string {
  const endpoint = `${appUrl.replace(/\/$/, '')}/api/infinitepay/token?token=${encodeURIComponent(env.webhookSecret)}`

  // Escrito em uma linha, sem aspas duplas, porque vira href de um link.
  const source = `
(function(){
  if (location.host !== 'app.infinitepay.io') {
    alert('Abra o painel da InfinitePay (app.infinitepay.io) e clique aqui de novo.');
    return;
  }
  if (window.__ipCaptura) { alert('A captura já está ligada nesta aba.'); return; }
  window.__ipCaptura = true;

  var ultimo = '';
  var enviados = 0;

  function enviar(valor, origem) {
    if (!valor || valor === ultimo) return;
    if (valor.indexOf('Bearer ') !== 0 && valor.indexOf('eyJ') !== 0) return;
    ultimo = valor;
    enviados++;
    try {
      fetch('${endpoint}&origem=' + encodeURIComponent((origem || '').slice(0, 200)), {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: valor
      });
    } catch (e) {}
    var aviso = document.getElementById('__ipAviso');
    if (aviso) aviso.textContent = 'Gestão: token enviado (' + enviados + ')';
  }

  function doHeaders(h, url) {
    if (!h) return;
    try {
      if (typeof h.get === 'function') { enviar(h.get('authorization') || h.get('Authorization'), url); return; }
      if (Array.isArray(h)) { for (var i = 0; i < h.length; i++) { if (String(h[i][0]).toLowerCase() === 'authorization') enviar(h[i][1], url); } return; }
      for (var k in h) { if (String(k).toLowerCase() === 'authorization') enviar(h[k], url); }
    } catch (e) {}
  }

  var fetchOriginal = window.fetch;
  window.fetch = function(entrada, opcoes) {
    try {
      var url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
      if (opcoes && opcoes.headers) doHeaders(opcoes.headers, url);
      else if (entrada && entrada.headers) doHeaders(entrada.headers, url);
    } catch (e) {}
    return fetchOriginal.apply(this, arguments);
  };

  var setOriginal = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(nome, valor) {
    try { if (String(nome).toLowerCase() === 'authorization') enviar(valor, this.__ipUrl || ''); } catch (e) {}
    return setOriginal.apply(this, arguments);
  };
  var openOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(metodo, url) { try { this.__ipUrl = url; } catch (e) {} return openOriginal.apply(this, arguments); };

  var barra = document.createElement('div');
  barra.id = '__ipAviso';
  barra.textContent = 'Gestão: capturando… navegue pelo painel';
  barra.style.cssText = 'position:fixed;z-index:2147483647;left:12px;bottom:12px;padding:8px 12px;border-radius:8px;background:#111;color:#fff;font:13px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)';
  document.body.appendChild(barra);
})();
`

  // As linhas são coladas sem separador, então **nenhum comentário `//` pode
  // sobrar** no `source`: ele comentaria todo o resto do programa, incluindo o
  // fecha-parênteses final, e o atalho não faria nada. O filtro abaixo é a
  // rede de proteção; `buildBookmarklet` tem teste que executa o resultado.
  const minified = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'))
    .join('')

  // Não deixa o descuido passar silencioso: um `//` no meio da linha quebraria
  // igual, e é melhor falhar no build do que entregar um favorito morto.
  if (/(^|[^:])\/\//.test(minified)) {
    throw new Error('O código do atalho não pode conter comentários de linha.')
  }

  return `javascript:${encodeURIComponent(minified)}`
}
