/*!
 * Provador virtual de quadros — Maperia
 * Versão 0.4.0 (troca de produto + foto da simulação; modo teste) — 26/11/2026
 *
 * Instalação: Google Tag Manager, tag "HTML personalizado" (ver README.md).
 * Tudo roda no navegador do visitante: nada é enviado a servidores,
 * nenhuma imagem da câmera é gravada.
 *
 * Escrito em JavaScript ES5 (var, function) de propósito, para o GTM
 * aceitar a tag sem erro de compilação.
 */
(function () {
  'use strict';

  if (window.__maperiaProvador) { return; }
  var API = window.__maperiaProvador = { versao: '0.4.0' };

  /* =====================================================================
   * CONFIGURAÇÃO CENTRAL
   * Produtos com medidas conferidas. Tem prioridade sobre o que for lido
   * da página. Chave = caminho da página do produto.
   * Em "tamanhos", a chave é o começo do nome da variação no site
   * (ex.: "Grande" casa com "Grande (83x56cm)").
   * larguraCm e alturaCm = medida EXTERNA, com moldura, do quadro pendurado.
   * ===================================================================== */
  var CONFIG = {
    produtos: {
      '/produtos/quadro-mapa-america-do-sul-cortica-luxo-50-alfinetes-de-bolinha-de-brinde/': {
        tamanhos: {
          'Grande': { larguraCm: 56, alturaCm: 83 },
          'Gigante': { larguraCm: 84, alturaCm: 125 }
        },
        molduraCm: 1.5
      },
      // Múndi Cortiça Luxo: horizontal; uma página por tamanho, sem variação
      '/produtos/quadro-mapa-mundi-cortica-luxo-grande-84-x-61-cm/': {
        tamanhos: { 'Grande': { larguraCm: 84, alturaCm: 61 } },
        molduraCm: 1.5
      },
      '/produtos/quadro-mapa-mundi-cortica-luxo-gigante-125-x-84-cm/': {
        tamanhos: { 'Gigante': { larguraCm: 125, alturaCm: 84 } },
        molduraCm: 1.5
      }
    },
    // MODO TESTE: com true, o botão só aparece para quem abrir a loja com
    // ?provador=teste no endereço (vale para a sessão inteira do navegador).
    // Para liberar para todos os clientes, trocar para false.
    // Para sair do teste no aparelho: abrir com ?provador=sair.
    modoTeste: true,
    corPadrao: '#00b4ef',      // azul da loja, usado se não der para ler a cor do botão Comprar
    alturaInicialTela: 0.42,   // no modo aproximado, o quadro abre com 42% da altura da tela
    maxImagensAnalisadas: 14   // limite de fotos da galeria testadas atrás da foto isolada
  };

  /* =====================================================================
   * Utilidades
   * ===================================================================== */
  function log() {
    if (API.debugAtivo && window.console) {
      var a = Array.prototype.slice.call(arguments); a.unshift('[provador]');
      console.log.apply(console, a);
    }
  }
  function h(tag, attrs, filhos) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) { continue; }
        var v = attrs[k];
        if (k === 'class') { el.className = v; }
        else if (k === 'text') { el.textContent = v; }
        else if (k === 'html') { el.innerHTML = v; }
        else if (k.indexOf('on') === 0) { el.addEventListener(k.substring(2), v); }
        else if (v !== null && v !== undefined && v !== false) { el.setAttribute(k, v); }
      }
    }
    if (filhos) {
      for (var i = 0; i < filhos.length; i++) {
        var f = filhos[i];
        if (f === null || f === undefined) { continue; }
        el.appendChild(typeof f === 'string' ? document.createTextNode(f) : f);
      }
    }
    return el;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmt(n) { return (Math.round(n * 10) / 10).toString().replace('.', ','); }
  function normalizarCaminho(p) {
    p = (p || '').split('?')[0].split('#')[0];
    if (p.charAt(p.length - 1) !== '/') { p += '/'; }
    return p;
  }

  /* =====================================================================
   * ProductDetector — é página de produto? quais os dados?
   * ===================================================================== */
  var ProductDetector = {
    ehPaginaDeProduto: function () {
      if (!/^\/produtos\//.test(location.pathname)) { return false; }
      return !!(document.body && (document.body.classList.contains('template-product') ||
        document.getElementById('product_form') || (window.LS && window.LS.product)));
    },
    variantes: function (doc, html) {
      if (!doc && window.LS && window.LS.variants && window.LS.variants.length) { return window.LS.variants; }
      var el = (doc || document).querySelector('#single-product[data-variants], [data-variants]');
      if (el) {
        try { return JSON.parse(el.getAttribute('data-variants')) || []; } catch (e) { /* segue */ }
      }
      var m = html ? /LS\.variants\s*=\s*(\[[\s\S]*?\]);\s*\n/.exec(html) : null;
      if (m) { try { return JSON.parse(m[1]) || []; } catch (e2) { /* segue */ } }
      return [];
    },
    ler: function () {
      var ls = window.LS && window.LS.product;
      var og = document.querySelector('meta[property="og:title"]');
      var h1 = document.querySelector('#single-product h1, h1');
      var nome = (ls && ls.name) || (og && og.getAttribute('content')) || (h1 && h1.textContent.trim()) || 'Quadro';
      return {
        id: ls ? ls.id : null,
        nome: nome,
        nomeCurto: nome.replace(/\s*\+.*$/, '').trim(),
        caminho: normalizarCaminho(location.pathname),
        url: location.href.split('#')[0].split('?')[0],
        variantes: this.variantes(),
        doc: document
      };
    },
    // outro produto da loja: busca a página dele no próprio site (sem API) e lê os dados
    _cache: {},
    buscar: function (url) {
      var self = this, chave = normalizarCaminho(url.replace(/^https?:\/\/[^\/]+/, ''));
      if (this._cache[chave]) { return Promise.resolve(this._cache[chave]); }
      return fetch(url, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) { throw new Error('http ' + r.status); }
        return r.text();
      }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var og = doc.querySelector('meta[property="og:title"]');
        var h1 = doc.querySelector('#single-product h1, h1');
        var nome = (og && og.getAttribute('content')) || (h1 && h1.textContent.trim()) || 'Quadro';
        var p = { id: null, nome: nome, nomeCurto: nome.replace(/\s*\+.*$/, '').trim(), caminho: chave,
          url: url.split('#')[0].split('?')[0], variantes: self.variantes(doc, html), doc: doc };
        self._cache[chave] = p;
        return p;
      });
    },
    // quadros sugeridos na própria página (relacionados), com nome, link e foto
    relacionados: function () {
      var aqui = normalizarCaminho(location.pathname), lista = [], vistos = {};
      function add(url, nome, img) {
        if (!url || !nome) { return; }
        if (url.indexOf('//') === 0) { url = 'https:' + url; }
        var cam = normalizarCaminho(url.replace(/^https?:\/\/[^\/]+/, ''));
        if (!/^\/produtos\//.test(cam) || cam === aqui || vistos[cam]) { return; }
        vistos[cam] = 1;
        lista.push({ url: url, caminho: cam, nome: nome.replace(/\s*\+.*$/, '').trim(), img: img || '' });
      }
      var blocos = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < blocos.length; i++) {
        var j = null;
        try { j = JSON.parse(blocos[i].textContent); } catch (e) { j = null; }
        if (j && j['@type'] === 'Product') {
          var u = (j.mainEntityOfPage && j.mainEntityOfPage['@id']) || (j.offers && j.offers.url);
          add(u, j.name, typeof j.image === 'string' ? j.image : (j.image && j.image[0]));
        }
      }
      if (!lista.length) {
        var cards = document.querySelectorAll('.js-item-product');
        for (var k = 0; k < cards.length; k++) {
          var a = cards[k].querySelector('a[href*="/produtos/"]'), im = cards[k].querySelector('img');
          add(a && a.getAttribute('href'), (a && (a.getAttribute('title') || a.textContent.trim())) || (im && im.getAttribute('alt')),
            im && (im.getAttribute('data-src') || im.getAttribute('src')));
        }
      }
      return lista;
    }
  };

  /* =====================================================================
   * ProductDimensions — medidas por tamanho
   * Ordem: CONFIG > nome da variação "(83x56cm)" > descrição técnica.
   * A orientação só é "confirmada" pela CONFIG ou pela foto isolada.
   * ===================================================================== */
  var RE_MEDIDA = /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*cm/i;
  var RE_MEDIDA_G = /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*cm/gi;
  function num(s) { return parseFloat(String(s).replace(',', '.')); }

  var ProductDimensions = {
    tamanhos: function (produto) {
      var conf = CONFIG.produtos[produto.caminho];
      var labels = [];
      var vs = produto.variantes || [];
      // descobre qual opção (option0/1/2) é a de tamanho
      var idxOpcao = -1;
      for (var o = 0; o < 3 && idxOpcao < 0; o++) {
        for (var i = 0; i < vs.length; i++) {
          var val = vs[i]['option' + o];
          if (!val) { continue; }
          if (RE_MEDIDA.test(val) || (conf && this._chaveConfig(conf, val))) { idxOpcao = o; break; }
        }
      }
      if (idxOpcao >= 0) {
        for (var j = 0; j < vs.length; j++) {
          var l = vs[j]['option' + idxOpcao];
          if (l && labels.indexOf(l) < 0) { labels.push(l); }
        }
      }
      var lista = [];
      for (var k = 0; k < labels.length; k++) { lista.push(this._montar(labels[k], conf)); }

      // sem variação de tamanho: tenta a configuração inteira, depois a descrição
      if (!lista.length && conf) {
        for (var ck in conf.tamanhos) {
          if (conf.tamanhos.hasOwnProperty(ck)) { lista.push(this._montar(ck, conf)); }
        }
      }
      if (!lista.length) {
        var d = this._doNome(produto.nome) || this._daDescricao(produto.doc || document);
        if (d) { lista.push(d); }
      }
      return { lista: lista, opcao: idxOpcao };
    },
    _chaveConfig: function (conf, label) {
      var low = label.toLowerCase();
      for (var k in conf.tamanhos) {
        if (conf.tamanhos.hasOwnProperty(k) && low.indexOf(k.toLowerCase()) === 0) { return k; }
      }
      return null;
    },
    _nomeCurto: function (label) { return label.replace(/\s*\(.*\)\s*$/, '').trim() || label; },
    _montar: function (label, conf) {
      var t = { label: label, nome: this._nomeCurto(label), larguraCm: null, alturaCm: null,
        fonte: null, orientacaoConfirmada: false };
      var ck = conf ? this._chaveConfig(conf, label) : null;
      if (ck) {
        t.larguraCm = conf.tamanhos[ck].larguraCm; t.alturaCm = conf.tamanhos[ck].alturaCm;
        t.fonte = 'configuração'; t.orientacaoConfirmada = true;
        return t;
      }
      var m = RE_MEDIDA.exec(label);
      if (m) {
        var a = num(m[1]), b = num(m[2]);
        // orientação provisória: em pé. A foto isolada confirma ou corrige.
        t.larguraCm = Math.min(a, b); t.alturaCm = Math.max(a, b); t.fonte = 'página';
        if (Math.abs(Math.log(a / b)) < 0.03) { t.orientacaoConfirmada = true; }
      }
      return t;
    },
    _doNome: function (nome) {
      var m = RE_MEDIDA.exec(nome || '');
      if (!m) { return null; }
      var a = num(m[1]), b = num(m[2]);
      var palavra = /(Pequeno|M[ée]dio|Grande|Gigante|Extragigante)\s*\(/i.exec(nome);
      return { label: palavra ? palavra[1] : 'Único', nome: palavra ? palavra[1] : 'Tamanho único',
        larguraCm: Math.min(a, b), alturaCm: Math.max(a, b), fonte: 'nome do produto', orientacaoConfirmada: Math.abs(Math.log(a / b)) < 0.03 };
    },
    _daDescricao: function (doc) {
      var el = (doc || document).querySelector('.js-product-description, .product-description, [data-store="product-description"], .user-content');
      var txt = (el ? el.textContent : '').replace(/\s+/g, ' ');
      var m = null;
      var trecho = /tamanho d[oa] (?:quadro|mapa|produto)[^:]{0,40}:([^.]{0,80})/i.exec(txt);
      var mt = trecho ? trecho[1].match(RE_MEDIDA_G) : null;
      if (mt && mt.length === 1) { m = RE_MEDIDA.exec(mt[0]); }
      if (!m) {
        var ms = txt.match(RE_MEDIDA_G);
        if (!ms || ms.length !== 1) { return null; }  // várias medidas no texto: ambíguo, não arrisca
        m = RE_MEDIDA.exec(ms[0]);
      }
      var a = num(m[1]), b = num(m[2]);
      return { label: 'Único', nome: 'Tamanho único', larguraCm: Math.min(a, b), alturaCm: Math.max(a, b),
        fonte: 'descrição', orientacaoConfirmada: false };
    },
    // tamanho escolhido hoje no seletor da página
    selecionadoNaPagina: function (tamanhos) {
      var form = document.getElementById('product_form') || document;
      var labels = []; for (var i = 0; i < tamanhos.lista.length; i++) { labels.push(tamanhos.lista[i].label); }
      var sels = form.querySelectorAll('select[name^="variation"]');
      for (var s = 0; s < sels.length; s++) {
        var ix = labels.indexOf(sels[s].value);
        if (ix >= 0) { return ix; }
      }
      var ativos = form.querySelectorAll('[data-option].selected, [data-option].active, [data-option][aria-pressed="true"], input[type="radio"][name^="variation"]:checked');
      for (var a = 0; a < ativos.length; a++) {
        var v = ativos[a].getAttribute('data-option') || ativos[a].value;
        var ix2 = labels.indexOf(v);
        if (ix2 >= 0) { return ix2; }
      }
      return 0;
    }
  };

  /* =====================================================================
   * ProductImageManager — acha a foto do quadro isolado (fundo branco)
   * e recorta só o quadro. Nunca usa a foto ambientada como textura.
   * ===================================================================== */
  var RE_TAM_IMG = /^(.*?)-\d+-\d+\.(webp|jpe?g|png)$/i;
  var ProductImageManager = {
    urlsDaGaleria: function (doc) {
      doc = doc || document;
      var bases = [];
      function add(u) {
        if (!u) { return; }
        u = u.trim().split(' ')[0];
        if (u.indexOf('//') === 0) { u = 'https:' + u; }
        if (!/mitiendanube|nuvemshop|cloudfront/i.test(u)) { return; }
        var m = RE_TAM_IMG.exec(u.split('?')[0]);
        var base = m ? m[1] + '|' + m[2] : u;
        if (bases.indexOf(base) < 0) { bases.push(base); }
      }
      var slides = doc.querySelectorAll('.js-product-slide:not(.js-product-video-slide)');
      for (var i = 0; i < slides.length; i++) {
        var a = slides[i].querySelector('a[href]'); var img = slides[i].querySelector('img');
        add(a && a.getAttribute('href'));
        if (!a && img) { add(img.getAttribute('data-src') || img.getAttribute('src')); }
      }
      if (!bases.length) {
        var imgs = doc.querySelectorAll('#single-product img, .product-detail img');
        for (var j = 0; j < imgs.length; j++) { add(imgs[j].getAttribute('data-src') || imgs[j].getAttribute('src')); }
      }
      var og = doc.querySelector('meta[property="og:image:secure_url"], meta[property="og:image"]');
      add(og && og.getAttribute('content'));
      var lista = [];
      for (var b = 0; b < bases.length; b++) {
        var p = bases[b].split('|');
        lista.push(p.length === 2
          ? { pequena: p[0] + '-480-0.' + p[1], grande: p[0] + '-1024-1024.' + p[1] }
          : { pequena: bases[b], grande: bases[b] });
      }
      return lista;
    },
    carregar: function (url) {
      return new Promise(function (ok, falha) {
        var img = new Image();
        img.crossOrigin = 'anonymous';    // necessário para usar no canvas (a CDN responde com CORS *)
        img.decoding = 'async';
        img.onload = function () { ok(img); };
        img.onerror = function () { falha(new Error('imagem')); };
        img.src = url + (url.indexOf('?') < 0 ? '?' : '&') + 'mprv=1';  // evita cópia do cache sem CORS
      });
    },
    // devolve a caixa do quadro (0..1) se a foto tiver fundo branco; null se não tiver
    analisar: function (img) {
      var S = 320, esc = Math.min(1, S / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(8, Math.round(img.naturalWidth * esc)), hh = Math.max(8, Math.round(img.naturalHeight * esc));
      var c = document.createElement('canvas'); c.width = w; c.height = hh;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, hh);
      var d;
      try { d = ctx.getImageData(0, 0, w, hh).data; } catch (e) { return { erro: 'cors' }; }
      function px(x, y) { var i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; }
      function canto(x0, y0) {
        var soma = 0, n = 0, croma = 0;
        for (var y = y0; y < y0 + 6; y++) {
          for (var x = x0; x < x0 + 6; x++) {
            var p = px(x, y); soma += (p[0] + p[1] + p[2]) / 3;
            croma += Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]); n++;
          }
        }
        return soma / n >= 240 && croma / n <= 14;
      }
      if (!(canto(2, 2) && canto(w - 8, 2) && canto(2, hh - 8) && canto(w - 8, hh - 8))) { return null; }
      var linhas = [], colunas = [], x, y;
      for (y = 0; y < hh; y++) { linhas.push(0); }
      for (x = 0; x < w; x++) { colunas.push(0); }
      for (y = 0; y < hh; y++) {
        for (x = 0; x < w; x++) {
          var p = px(x, y), lum = (p[0] + p[1] + p[2]) / 3, cr = Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
          // moldura de madeira (cor saturada) ou miolo escuro; a sombra cinza fica de fora
          if (cr > 45 || lum < 120) { linhas[y]++; colunas[x]++; }
        }
      }
      function faixa(arr, total) {
        var ini = -1, fim = -1;
        for (var i = 0; i < arr.length; i++) { if (arr[i] > total * 0.15) { if (ini < 0) { ini = i; } fim = i; } }
        return [ini, fim];
      }
      var fy = faixa(linhas, w), fx = faixa(colunas, hh);
      if (fy[0] < 0 || fx[0] < 0) { return null; }
      var caixa = { x: fx[0] / w, y: fy[0] / hh, w: (fx[1] - fx[0] + 1) / w, h: (fy[1] - fy[0] + 1) / hh };
      if (caixa.w * caixa.h < 0.12 || caixa.w > 0.98 || caixa.h > 0.98) { return null; }
      return { caixa: caixa };
    },
    // procura na galeria a primeira foto de fundo branco
    acharIsolada: function (doc) {
      var lista = this.urlsDaGaleria(doc).slice(0, CONFIG.maxImagensAnalisadas);
      var self = this, i = 0, houveCors = false;
      return new Promise(function (ok) {
        function prox() {
          if (i >= lista.length) { ok({ achou: false, lista: lista, cors: houveCors }); return; }
          var item = lista[i++];
          self.carregar(item.pequena).then(function (img) {
            var r = self.analisar(img);
            if (r && r.erro) { houveCors = true; prox(); return; }
            if (r && r.caixa) { log('foto isolada', item.grande, r.caixa); ok({ achou: true, item: item, caixa: r.caixa, lista: lista }); return; }
            prox();
          }, function () { prox(); });
        }
        prox();
      });
    },
    // recorta o quadro na proporção exata (largura/altura reais)
    recortar: function (img, caixa, proporcao) {
      var nw = img.naturalWidth, nh = img.naturalHeight;
      var sx = caixa.x * nw, sy = caixa.y * nh, sw = caixa.w * nw, sh = caixa.h * nh;
      var a = sw / sh, dif = Math.abs(a / proporcao - 1);
      // até 2,5%: é só arredondamento do contorno; ajusta sem cortar a moldura (imperceptível)
      if (dif <= 0.025) { /* usa a caixa inteira */ }
      // até 8%: sobra de sombra à direita/embaixo: corta desse lado
      else if (dif < 0.08) {
        if (a > proporcao) { sw = sh * proporcao; } else { sh = sw / proporcao; }
      } else {
        // diferença grande: corta igual dos dois lados (cover), sem deformar
        if (a > proporcao) { var nsw = sh * proporcao; sx += (sw - nsw) / 2; sw = nsw; }
        else { var nsh = sw / proporcao; sy += (sh - nsh) / 2; sh = nsh; }
      }
      var maxLado = 1400, k = Math.min(1, maxLado / Math.max(sw, sh));
      var c = document.createElement('canvas');
      c.width = Math.round(sw * k); c.height = Math.round(sh * k);
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c;
    }
  };

  /* =====================================================================
   * CompatibilityManager
   * ===================================================================== */
  var Compat = {
    temCamera: function () { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    navegadorInterno: function () {
      var ua = navigator.userAgent || '';
      if (/Instagram/i.test(ua)) { return 'Instagram'; }
      if (/FBAN|FBAV|FB_IAB/i.test(ua)) { return 'Facebook'; }
      if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) { return 'TikTok'; }
      return null;
    },
    ios: function () { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  };

  /* =====================================================================
   * CameraManager
   * ===================================================================== */
  var CameraManager = {
    stream: null,
    abrir: function (video) {
      var self = this;
      if (!Compat.temCamera()) { return Promise.reject({ tipo: 'sem-api' }); }
      this.fechar();
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      }).then(function (st) {
        self.stream = st;
        video.srcObject = st;
        var p = video.play();
        return (p && p.then ? p : Promise.resolve()).then(function () { return st; });
      }, function (e) {
        var n = e && e.name;
        var tipo = n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError' ? 'negada'
          : n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError' ? 'sem-camera'
          : n === 'NotReadableError' || n === 'TrackStartError' ? 'ocupada' : 'falha';
        throw { tipo: tipo, erro: e };
      });
    },
    fechar: function (video) {
      if (this.stream) {
        var t = this.stream.getTracks();
        for (var i = 0; i < t.length; i++) { try { t[i].stop(); } catch (e) { /* ok */ } }
      }
      this.stream = null;
      if (video) { try { video.pause(); } catch (e2) { /* ok */ } video.srcObject = null; }
    },
    ligada: function () { return !!this.stream; }
  };

  /* =====================================================================
   * Estilos (dentro do Shadow DOM: não vazam para a loja e vice-versa)
   * ===================================================================== */
  var FONTE = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  function cssBotaoPagina(cor) {
    return ':host{all:initial;display:block;margin:4px 0 18px}' +
      '.b{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:14px;padding:14px 18px;' +
      'border:1.5px solid ' + cor + ';border-radius:14px;background:#fff;color:#1d2125;cursor:pointer;' +
      'font-family:' + FONTE + ';text-align:left;transition:background .2s,transform .1s;-webkit-tap-highlight-color:transparent}' +
      '.b:hover{background:' + cor + '0f}.b:active{transform:scale(.985)}' +
      '.i{flex:0 0 42px;height:42px;border-radius:50%;background:' + cor + ';display:flex;align-items:center;justify-content:center}' +
      '.i svg{width:22px;height:22px}' +
      '.t{display:block;font-size:14px;font-weight:700;letter-spacing:.12em;color:' + cor + '}' +
      '.s{display:block;margin-top:3px;font-size:12.5px;line-height:1.35;color:#5b636b}';
  }

  function cssProvador(cor) {
    return '' +
      ':host{all:initial}' +
      '*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}' +
      '.raiz{position:fixed;inset:0;z-index:2147483647;background:#0c0e11;color:#f4f5f6;font-family:' + FONTE + ';' +
      'display:flex;flex-direction:column;overflow:hidden;opacity:0;transition:opacity .25s ease;touch-action:none;' +
      '-webkit-user-select:none;user-select:none;font-size:14px}' +
      '.raiz.on{opacity:1}' +
      'button{font-family:inherit;color:inherit;border:0;background:none;cursor:pointer;padding:0}' +
      'svg{display:block}' +
      /* cabeçalho */
      '.topo{position:absolute;left:0;right:0;top:0;z-index:9;display:flex;align-items:center;gap:10px;' +
      'padding:calc(10px + env(safe-area-inset-top)) 12px 18px;background:linear-gradient(#000a,#0000)}' +
      '.fechar{flex:0 0 42px;height:42px;border-radius:50%;background:#ffffff1f;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center}' +
      '.titulo{flex:1;min-width:0}' +
      '.titulo b{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.titulo span{display:block;font-size:12px;color:#ffffffb3;margin-top:2px}' +
      /* palco */
      '.palco{position:relative;flex:1;overflow:hidden;background:#15181c}' +
      '.palco video,.palco .foto{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
      '.quadro{position:absolute;left:0;top:0;will-change:transform;transform-origin:0 0}' +
      '.quadro canvas,.quadro .contorno{width:100%;height:100%;display:block;box-shadow:0 18px 30px -12px #000a,0 4px 10px #0006}' +
      '.contorno{border:2px dashed #fff;background:#ffffff14;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;color:#fff;padding:8px}' +
      '.medida{position:absolute;left:50%;top:100%;margin-top:10px;transform:translateX(-50%);white-space:nowrap;' +
      'background:#0c0e11cc;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:5px 10px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.02em}' +
      '.selo{position:absolute;left:50%;transform:translateX(-50%);top:calc(70px + env(safe-area-inset-top));z-index:4;display:flex;align-items:center;gap:6px;' +
      'padding:7px 12px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}' +
      '.selo.aprox{background:#1b1608d9;color:#ffd98a;border:1px solid #f5b94280}' +
      '.selo.real{background:#08180fd9;color:#9ff0c0;border:1px solid #2ecc7180}' +
      '.selo u{text-decoration:underline;text-underline-offset:2px}' +
      /* rodapé */
      '.base{position:relative;z-index:5;padding:12px 12px calc(12px + env(safe-area-inset-bottom));background:#0c0e11}' +
      '.tamanhos{display:flex;gap:8px;margin-bottom:12px}' +
      '.tam{flex:1;padding:9px 6px;border-radius:12px;background:#ffffff12;border:1.5px solid transparent;text-align:center}' +
      '.tam b{display:block;font-size:13px;font-weight:600}.tam span{display:block;font-size:11.5px;color:#ffffff99;margin-top:2px}' +
      '.tam.on{border-color:' + cor + ';background:' + cor + '26}' +
      '.acoes{display:flex;justify-content:space-around;gap:4px}' +
      '.ac{flex:1;max-width:84px;display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11px;color:#ffffffcc;padding:2px 0}' +
      '.ac i{width:46px;height:46px;border-radius:50%;background:#ffffff14;display:flex;align-items:center;justify-content:center}' +
      '.ac:active i{background:#ffffff2e}.ac[disabled]{opacity:.35}' +
      '.ac.dest i{background:' + cor + '}' +
      /* telas de mensagem / introdução */
      '.tela{position:absolute;inset:0;z-index:8;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;background:#0c0e11f2}' +
      '.tela h2{margin:14px 0 8px;font-size:21px;font-weight:700;line-height:1.25}' +
      '.tela p{margin:0 0 6px;max-width:330px;font-size:14px;line-height:1.5;color:#ffffffbf}' +
      '.tela .peq{font-size:12px;color:#ffffff8c;margin-top:14px}' +
      '.tela .aviso{margin-top:14px;padding:10px 12px;border-radius:12px;background:#f5b9421f;color:#ffd98a;font-size:12.5px;max-width:330px;line-height:1.45}' +
      '.thumb{display:block;width:auto;height:auto;max-width:170px;max-height:150px;border-radius:3px;box-shadow:0 12px 30px #0009}' +
      '.btn{display:block;width:100%;max-width:320px;margin-top:12px;padding:15px;border-radius:14px;font-size:15px;font-weight:700;letter-spacing:.02em}' +
      '.btn.pri{background:' + cor + ';color:#fff}.btn.sec{background:#ffffff17;color:#fff}' +
      '.btn.lnk{background:none;color:#ffffffb3;font-weight:500;font-size:14px;padding:10px}' +
      '.spin{width:34px;height:34px;border-radius:50%;border:3px solid #ffffff33;border-top-color:' + cor + ';animation:g 0.9s linear infinite}' +
      '@keyframes g{to{transform:rotate(360deg)} }' +
      /* calibração */
      '.cal{position:absolute;inset:0;z-index:6}' +
      '.ref{position:absolute;border:2px solid ' + cor + ';background:' + cor + '29;box-shadow:0 0 0 9999px #0007}' +
      '.ref .rot{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:12px;font-weight:700;text-align:center;line-height:1.3;text-shadow:0 1px 3px #000}' +
      '.alca{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:#fff;border:3px solid ' + cor + ';box-shadow:0 2px 8px #0008}' +
      '.linha{position:absolute;height:3px;background:' + cor + ';transform-origin:0 50%;box-shadow:0 0 0 1px #0006}' +
      '.painel{position:absolute;left:0;right:0;bottom:0;z-index:7;padding:16px 16px calc(16px + env(safe-area-inset-bottom));background:#0c0e11f5;border-radius:20px 20px 0 0}' +
      '.painel h3{margin:0 0 4px;font-size:16px}.painel p{margin:0 0 12px;font-size:13px;line-height:1.45;color:#ffffffbf}' +
      '.seg{display:flex;background:#ffffff12;border-radius:12px;padding:3px;margin-bottom:12px}' +
      '.seg button{flex:1;padding:9px;border-radius:10px;font-size:13px;font-weight:600;color:#ffffffb3}' +
      '.seg button.on{background:#ffffff26;color:#fff}' +
      '.campo{display:flex;align-items:center;gap:8px;margin-bottom:12px}' +
      '.campo input{flex:1;min-width:0;padding:12px;border-radius:12px;border:1.5px solid #ffffff33;background:#ffffff0f;color:#fff;font-size:16px;font-family:inherit}' +
      '.linhaBtns{display:flex;gap:10px}.linhaBtns .btn{margin-top:0}' +
      /* aviso rápido */
      '.toast{position:absolute;left:50%;bottom:100px;transform:translate(-50%,20px);z-index:9;max-width:88%;padding:10px 14px;border-radius:12px;background:#000d;color:#fff;font-size:13px;line-height:1.4;text-align:center;opacity:0;transition:all .25s;pointer-events:none}' +
      '.toast.on{opacity:1;transform:translate(-50%,0)}' +
      '.obt{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:5;width:70px;height:70px;border-radius:50%;' +
      'background:#fff;border:4px solid #ffffff66;background-clip:padding-box;box-shadow:0 4px 18px #0007;display:flex;align-items:center;justify-content:center;color:#1d2125}' +
      '.obt:active{transform:translateX(-50%) scale(.93)}' +
      '.obt span{position:absolute;top:100%;margin-top:6px;font-size:11px;font-weight:600;color:#fff;white-space:nowrap;text-shadow:0 1px 3px #000}' +
      '.flash{position:absolute;inset:0;z-index:8;background:#fff;opacity:0;pointer-events:none;transition:opacity .35s}' +
      '.flash.on{opacity:.85;transition:none}' +
      '.previa{position:absolute;inset:0;z-index:10;background:#0c0e11;display:flex;flex-direction:column;padding:calc(14px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))}' +
      '.previa h3{margin:4px 0 10px;font-size:16px;text-align:center}' +
      '.previa .img{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}' +
      '.previa img{max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 10px 30px #0009;-webkit-touch-callout:default;-webkit-user-select:auto;user-select:auto}' +
      '.previa .dica{margin:10px 0 0;text-align:center;font-size:12.5px;color:#ffffffa6}' +
      '.previa .linhaBtns{margin-top:12px}' +
      '.verLoja{flex:0 0 auto;padding:9px 12px;border-radius:999px;background:' + cor + ';color:#fff;font-size:12.5px;font-weight:700;text-decoration:none;white-space:nowrap}' +
      '.folha{position:absolute;inset:0;z-index:10;background:#0008;display:flex;flex-direction:column;justify-content:flex-end}' +
      '.folha .caixa{background:#14171b;border-radius:20px 20px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));max-height:78%;display:flex;flex-direction:column}' +
      '.folha h3{margin:0 0 4px;font-size:16px}.folha .sub{margin:0 0 12px;font-size:12.5px;color:#ffffffa6}' +
      '.folha .grade{overflow-y:auto;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding-bottom:4px;touch-action:pan-y}' +
      '.cartao{position:relative;display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:14px;background:#ffffff0f;border:1.5px solid transparent;text-align:left}' +
      '.cartao.on{border-color:' + cor + '}' +
      '.cartao img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:9px;background:#ffffff14}' +
      '.cartao b{font-size:12.5px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.cartao small{font-size:11px;color:#ffffff8c}' +
      '.cartao .spin{position:absolute;left:50%;top:38%;margin:-17px 0 0 -17px}' +
      '.folha .rod{display:flex;gap:10px;margin-top:12px}.folha .rod .btn{margin-top:0}' +
      '.oculto{display:none!important}' +
      '@media (orientation:landscape) and (max-height:500px){.tamanhos{margin-bottom:8px}.ac i{width:40px;height:40px}.selo{top:calc(58px + env(safe-area-inset-top))} }';
  }

  /* ícones (traço) */
  function ic(path, tam, cor) {
    tam = tam || 22;
    return '<svg viewBox="0 0 24 24" width="' + tam + '" height="' + tam + '" fill="none" stroke="' + (cor || 'currentColor') +
      '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  }
  var ICONE = {
    parede: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 7h8M8 11h5"/><path d="M2 21h20"/>',
    fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    menos: '<path d="M5 12h14"/>',
    centro: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    regua: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    girar: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    camera: '<path d="M3 8h3l2-3h8l2 3h3v12H3z"/><circle cx="12" cy="13.5" r="3.5"/>',
    foto: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    baixar: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    quadros: '<rect x="3" y="5" width="8" height="12" rx="1"/><rect x="13" y="7" width="8" height="10" rx="1"/><path d="M3 21h18"/>'
  };

  /* =====================================================================
   * Provador (UserInterface + ManualPlacement + calibração)
   * ===================================================================== */
  function Provador(produto, tamanhos, cor) {
    this.produto = produto;
    this.tamanhos = tamanhos;
    this.cor = cor;
    this.idx = ProductDimensions.selecionadoNaPagina(tamanhos);
    this.girado = false;             // só usado quando a orientação não está confirmada
    this.pxPorCm = null;             // escala atual (pixels da tela por cm na parede)
    this.calibrado = false;
    this.refCal = '';
    this.cx = 0; this.cy = 0;        // centro do quadro no palco (px)
    this.modo = null;                // 'camera' | 'foto'
    this.textura = null;             // canvas com o quadro recortado
    this.imgStatus = 'carregando';
    this.ponteiros = {};
    this.gesto = null;
    this._handlers = [];
  }

  Provador.prototype.tamanho = function () {
    var t = this.tamanhos.lista[this.idx] || null;
    if (!t || !t.larguraCm) { return t; }
    if (this.girado) { return { label: t.label, nome: t.nome, larguraCm: t.alturaCm, alturaCm: t.larguraCm, fonte: t.fonte, orientacaoConfirmada: t.orientacaoConfirmada }; }
    return t;
  };
  Provador.prototype.temMedidas = function () { var t = this.tamanho(); return !!(t && t.larguraCm && t.alturaCm); };

  Provador.prototype.abrir = function () {
    var self = this;
    this.host = h('div', { id: 'mprv-provador' });
    document.body.appendChild(this.host);
    var root = this.host.attachShadow ? this.host.attachShadow({ mode: 'open' }) : this.host;
    this.root = root;
    root.appendChild(h('style', { text: cssProvador(this.cor) }));
    this.montar();
    this.esconderFlutuantes();
    // trava a rolagem da página por baixo
    this._overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    // botão "voltar" do Android fecha o provador
    try { history.pushState({ mprv: 1 }, ''); this._hist = true; } catch (e) { this._hist = false; }
    this.on(window, 'popstate', function () { if (self._hist) { self._hist = false; self.fechar(); } });
    this.on(window, 'resize', function () { self.relayout(); });
    this.on(window, 'orientationchange', function () { setTimeout(function () { self.relayout(); }, 300); });
    this.on(document, 'visibilitychange', function () {
      if (document.hidden && self.modo === 'camera' && CameraManager.ligada()) {
        CameraManager.fechar(self.video); self._pausada = true;
      } else if (!document.hidden && self._pausada) {
        self._pausada = false; self.mostrarTela('pausada');
      }
    });
    this.on(window, 'pagehide', function () { CameraManager.fechar(self.video); });
    requestAnimationFrame(function () { self.raiz.classList.add('on'); });
    this.prepararImagem();
    this.mostrarTela('intro');
  };

  // selos flutuantes de outros serviços (ex.: avaliações do Google, z-index máximo)
  // ficariam por cima do provador: somem enquanto ele está aberto e voltam ao fechar
  Provador.prototype.esconderFlutuantes = function () {
    var lista = [], vistos = [];
    function add(el) { if (el && el !== this.host && vistos.indexOf(el) < 0) { vistos.push(el); lista.push(el); } }
    var self = this;
    var conhecidos = document.querySelectorAll('#google-merchantwidget-iframe-wrapper, iframe[src*="merchantwidget"]');
    for (var i = 0; i < conhecidos.length; i++) { add.call(self, conhecidos[i]); }
    var filhos = document.body.children;
    for (var j = 0; j < filhos.length; j++) {
      var el = filhos[j];
      if (el === this.host) { continue; }
      var cs = getComputedStyle(el);
      if (cs.position === 'fixed' && parseInt(cs.zIndex, 10) >= 100000) { add.call(self, el); }
    }
    this._escondidos = [];
    for (var k = 0; k < lista.length; k++) {
      var e = lista[k];
      this._escondidos.push([e, e.style.getPropertyValue('visibility'), e.style.getPropertyPriority('visibility')]);
      e.style.setProperty('visibility', 'hidden', 'important');
    }
  };
  Provador.prototype.mostrarFlutuantes = function () {
    var l = this._escondidos || [];
    for (var i = 0; i < l.length; i++) {
      if (l[i][1]) { l[i][0].style.setProperty('visibility', l[i][1], l[i][2]); }
      else { l[i][0].style.removeProperty('visibility'); }
    }
    this._escondidos = [];
  };

  Provador.prototype.on = function (alvo, ev, fn, opt) {
    alvo.addEventListener(ev, fn, opt || false);
    this._handlers.push([alvo, ev, fn, opt || false]);
  };

  Provador.prototype.fechar = function () {
    if (this._fechado) { return; }
    this._fechado = true;
    CameraManager.fechar(this.video);
    if (this._fotoUrl) { URL.revokeObjectURL(this._fotoUrl); }
    if (this._snapUrl) { URL.revokeObjectURL(this._snapUrl); }
    for (var i = 0; i < this._handlers.length; i++) {
      var x = this._handlers[i]; x[0].removeEventListener(x[1], x[2], x[3]);
    }
    document.documentElement.style.overflow = this._overflow || '';
    this.mostrarFlutuantes();
    var host = this.host, self = this;
    this.raiz.classList.remove('on');
    setTimeout(function () { if (host.parentNode) { host.parentNode.removeChild(host); } }, 260);
    if (this._hist) { this._hist = false; try { history.back(); } catch (e) { /* ok */ } }
    API.atual = null;
    self.textura = null;
  };

  Provador.prototype.montar = function () {
    var self = this;
    this.raiz = h('div', { class: 'raiz', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Provador virtual de quadros' });

    // topo
    this.elTitulo = h('b', { text: this.produto.nomeCurto });
    this.elSub = h('span');
    var btFechar = h('button', { class: 'fechar', 'aria-label': 'Fechar o provador', html: ic(ICONE.fechar, 20), onclick: function () { self.fechar(); } });
    this.btLoja = h('a', { class: 'verLoja oculto', href: '#', text: 'Ver na loja' });
    this.raiz.appendChild(h('div', { class: 'topo' }, [btFechar, h('div', { class: 'titulo' }, [this.elTitulo, this.elSub]), this.btLoja]));

    // palco
    this.palco = h('div', { class: 'palco' });
    this.video = h('video', { playsinline: '', 'webkit-playsinline': '', muted: '', autoplay: '' });
    this.video.muted = true;
    this.foto = h('img', { class: 'foto oculto', alt: '' });
    this.quadro = h('div', { class: 'quadro oculto' });
    this.elMedida = h('div', { class: 'medida' });
    this.selo = h('button', { class: 'selo aprox oculto', onclick: function () { self.abrirCalibracao(); } });
    this.palco.appendChild(this.video);
    this.palco.appendChild(this.foto);
    this.palco.appendChild(this.quadro);
    this.palco.appendChild(this.selo);
    this.btFoto = h('button', { class: 'obt oculto', 'aria-label': 'Tirar foto da simulação', html: ic(ICONE.camera, 28) + '<span>TIRAR FOTO</span>', onclick: function () { self.tirarFoto(); } });
    this.palco.appendChild(this.btFoto);
    this.flash = h('div', { class: 'flash' });
    this.palco.appendChild(this.flash);
    this.toastEl = h('div', { class: 'toast', role: 'status' });
    this.palco.appendChild(this.toastEl);
    this.raiz.appendChild(this.palco);

    // rodapé
    this.base = h('div', { class: 'base oculto' });
    this.elTams = h('div', { class: 'tamanhos' });
    this.montarTamanhos();
    function acao(icone, rotulo, fn, extra) {
      return h('button', { class: 'ac' + (extra ? ' ' + extra : ''), 'aria-label': rotulo, onclick: fn },
        [h('i', { html: ic(icone) }), h('span', { text: rotulo })]);
    }
    this.btMenos = acao(ICONE.menos, 'Menor', function () { self.zoom(1 / 1.12); });
    this.btMais = acao(ICONE.mais, 'Maior', function () { self.zoom(1.12); });
    this.btCentro = acao(ICONE.centro, 'Centralizar', function () { self.centralizar(); });
    this.btEscala = acao(ICONE.regua, 'Escala real', function () { self.abrirCalibracao(); });
    this.btGirar = acao(ICONE.girar, 'Girar', function () { self.girar(); });
    this.btFonte = acao(ICONE.foto, 'Usar foto', function () { self.alternarFonte(); });
    this.btOutro = acao(ICONE.quadros, 'Outro quadro', function () { self.abrirTroca(); });
    this.base.appendChild(this.elTams);
    this.base.appendChild(h('div', { class: 'acoes' }, [this.btMenos, this.btMais, this.btCentro, this.btEscala, this.btGirar, this.btOutro, this.btFonte]));
    this.raiz.appendChild(this.base);

    // entrada de arquivo (foto da parede)
    this.inputFoto = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'oculto' });
    this.inputFoto.addEventListener('change', function () { self.receberFoto(); });
    this.raiz.appendChild(this.inputFoto);

    this.root.appendChild(this.raiz);
    this.ligarGestos();
    this.atualizarTextos();
  };

  /* ---------- telas (introdução, erros, carregando) ---------- */
  Provador.prototype.mostrarTela = function (tipo, info) {
    var self = this;
    if (this.tela && this.tela.parentNode) { this.tela.parentNode.removeChild(this.tela); }
    this.tela = null;
    if (!tipo) { return; }
    var filhos = [];
    function btn(txt, cls, fn) { return h('button', { class: 'btn ' + cls, text: txt, onclick: fn }); }
    var interno = Compat.navegadorInterno();
    var semApi = !Compat.temCamera();

    if (tipo === 'intro') {
      if (this.textura) {
        var mini = h('canvas', { class: 'thumb' });
        mini.width = this.textura.width; mini.height = this.textura.height;
        mini.getContext('2d').drawImage(this.textura, 0, 0);
        filhos.push(mini);
      } else {
        filhos.push(h('div', { html: ic(ICONE.parede, 46, this.cor) }));
      }
      filhos.push(h('h2', { text: 'Veja o quadro na sua parede' }));
      filhos.push(h('p', { text: 'Aponte a câmera para a parede, arraste o quadro para o lugar e ajuste o tamanho com dois dedos.' }));
      if (!semApi) { filhos.push(btn('Abrir a câmera', 'pri', function () { self.iniciarCamera(); })); }
      filhos.push(btn('Usar uma foto da parede', semApi ? 'pri' : 'sec', function () { self.escolherFoto(); }));
      if (interno || semApi) {
        filhos.push(h('div', { class: 'aviso', text: interno
          ? 'Você está no navegador do ' + interno + ', que pode bloquear a câmera ao vivo. Se não abrir, use uma foto da parede ou abra esta página no ' + (Compat.ios() ? 'Safari' : 'Chrome') + '.'
          : 'Este navegador não libera a câmera ao vivo. Você pode usar uma foto da parede.' }));
      }
      filhos.push(h('p', { class: 'peq', text: 'A câmera só é usada para mostrar o quadro no seu ambiente. A imagem fica no seu celular: nada é gravado nem enviado.' }));
    } else if (tipo === 'carregando') {
      filhos.push(h('div', { class: 'spin' }));
      filhos.push(h('p', { class: 'peq', text: info || 'Abrindo a câmera…' }));
    } else if (tipo === 'erro-camera') {
      var msgs = {
        'negada': ['A câmera não foi liberada', 'Para usar a câmera, permita o acesso nas configurações do navegador e tente de novo. Ou use uma foto da parede.'],
        'sem-camera': ['Não encontramos uma câmera', 'Este aparelho não tem câmera disponível. Você pode usar uma foto da parede.'],
        'ocupada': ['A câmera está em uso', 'Outro aplicativo está usando a câmera. Feche-o e tente de novo, ou use uma foto da parede.'],
        'sem-api': ['Câmera indisponível neste navegador', interno ? 'O navegador do ' + interno + ' não libera a câmera. Use uma foto da parede ou abra esta página no ' + (Compat.ios() ? 'Safari' : 'Chrome') + '.' : 'Use uma foto da parede ou abra esta página no Safari ou no Chrome.'],
        'falha': ['Não foi possível abrir a câmera', 'Tente de novo ou use uma foto da parede.']
      };
      var m = msgs[info] || msgs.falha;
      filhos.push(h('div', { html: ic(ICONE.camera, 42, '#ffd98a') }));
      filhos.push(h('h2', { text: m[0] }));
      filhos.push(h('p', { text: m[1] }));
      filhos.push(btn('Usar uma foto da parede', 'pri', function () { self.escolherFoto(); }));
      if (info !== 'sem-api' && info !== 'sem-camera') { filhos.push(btn('Tentar a câmera de novo', 'sec', function () { self.iniciarCamera(); })); }
      filhos.push(btn('Voltar para a loja', 'lnk', function () { self.fechar(); }));
    } else if (tipo === 'pausada') {
      filhos.push(h('div', { html: ic(ICONE.camera, 42, this.cor) }));
      filhos.push(h('h2', { text: 'Câmera pausada' }));
      filhos.push(h('p', { text: 'Desligamos a câmera enquanto você estava fora da página.' }));
      filhos.push(btn('Ligar a câmera de novo', 'pri', function () { self.iniciarCamera(); }));
      filhos.push(btn('Voltar para a loja', 'lnk', function () { self.fechar(); }));
    } else if (tipo === 'erro-geral') {
      filhos.push(h('h2', { text: 'Algo deu errado' }));
      filhos.push(h('p', { text: 'Não foi possível abrir o provador agora. Tente de novo em instantes.' }));
      filhos.push(btn('Voltar para a loja', 'pri', function () { self.fechar(); }));
    }
    this.tela = h('div', { class: 'tela' }, filhos);
    this.raiz.appendChild(this.tela);
  };

  /* ---------- imagem do quadro ---------- */
  Provador.prototype.prepararImagem = function () {
    var self = this, token = this._imgToken = (this._imgToken || 0) + 1;
    function velho() { return self._fechado || token !== self._imgToken; }
    ProductImageManager.acharIsolada(this.produto.doc).then(function (r) {
      if (velho()) { return; }
      if (!r.achou) {
        self.imgStatus = r.cors ? 'erro' : 'sem-isolada';
        log('sem foto isolada', r);
        self.render(); self.renderQuadro();
        self.avisarTroca();
        if (self.modo) { self.toast('Não achamos a foto do quadro sozinho. Mostrando o contorno com as medidas.', 4500); }
        return;
      }
      return ProductImageManager.carregar(r.item.grande).then(function (img) {
        if (velho()) { return; }
        self._img = img; self._caixa = r.caixa;
        self.confirmarOrientacao();
        self.gerarTextura();
        self.imgStatus = 'ok';
        self.render(); self.renderQuadro();
        self.avisarTroca();
        if (self.tela && !self.modo) { self.mostrarTela('intro'); }
      });
    }).then(null, function (e) {
      if (velho()) { return; }
      log('erro imagem', e);
      self.imgStatus = 'erro';
      self.render(); self.renderQuadro();
      self.avisarTroca();
    });
  };

  // se as medidas vieram da página (sem orientação), a proporção da foto decide
  Provador.prototype.confirmarOrientacao = function () {
    var c = this._caixa, img = this._img;
    if (!c || !img) { return; }
    var aFoto = (c.w * img.naturalWidth) / (c.h * img.naturalHeight);
    var lista = this.tamanhos.lista;
    for (var i = 0; i < lista.length; i++) {
      var t = lista[i];
      if (!t.larguraCm || t.orientacaoConfirmada) { continue; }
      var emPe = t.larguraCm / t.alturaCm, deitado = t.alturaCm / t.larguraCm;
      // quase quadrado (ex.: 60 × 61): a orientação não muda nada na simulação
      if (Math.abs(Math.log(emPe)) < 0.03) { t.orientacaoConfirmada = true; t.fonteOrientacao = 'quase quadrado'; continue; }
      var dEmPe = Math.abs(Math.log(aFoto / emPe)), dDeit = Math.abs(Math.log(aFoto / deitado));
      if (Math.min(dEmPe, dDeit) < 0.08) {
        if (dDeit < dEmPe) { var w = t.larguraCm; t.larguraCm = t.alturaCm; t.alturaCm = w; }
        t.orientacaoConfirmada = true; t.fonteOrientacao = 'foto';
      }
    }
  };

  Provador.prototype.gerarTextura = function () {
    var t = this.tamanho();
    if (!this._img || !this._caixa) { this.textura = null; return; }
    var prop = t && t.larguraCm ? t.larguraCm / t.alturaCm
      : (this._caixa.w * this._img.naturalWidth) / (this._caixa.h * this._img.naturalHeight);
    var chave = prop.toFixed(4);
    if (this._texChave === chave && this.textura) { return; }
    this._texChave = chave;
    var c = ProductImageManager.recortar(this._img, this._caixa, this.girado ? 1 / prop : prop);
    if (this.girado) {
      var r = document.createElement('canvas'); r.width = c.height; r.height = c.width;
      var cx = r.getContext('2d'); cx.translate(r.width / 2, r.height / 2); cx.rotate(Math.PI / 2);
      cx.drawImage(c, -c.width / 2, -c.height / 2); c = r;
    }
    this.textura = c;
  };

  /* ---------- fontes de imagem: câmera ao vivo ou foto ---------- */
  Provador.prototype.iniciarCamera = function () {
    var self = this;
    this.mostrarTela('carregando', 'Abrindo a câmera…');
    CameraManager.abrir(this.video).then(function () {
      if (self._fechado) { CameraManager.fechar(self.video); return; }
      self.modo = 'camera';
      self.video.classList.remove('oculto');
      self.foto.classList.add('oculto');
      if (self.calibrado && self.refCal) { self.descalibrar(true); }
      self.entrarNoPalco();
    }, function (e) {
      if (self._fechado) { return; }
      log('camera', e);
      self.mostrarTela('erro-camera', e && e.tipo);
    });
  };

  Provador.prototype.escolherFoto = function () {
    this.inputFoto.value = '';
    this.inputFoto.click();
  };

  Provador.prototype.receberFoto = function () {
    var self = this;
    var f = this.inputFoto.files && this.inputFoto.files[0];
    if (!f) { return; }
    CameraManager.fechar(this.video);
    if (this._fotoUrl) { URL.revokeObjectURL(this._fotoUrl); }
    this._fotoUrl = URL.createObjectURL(f);   // a foto fica só na memória do navegador
    this.mostrarTela('carregando', 'Abrindo a foto…');
    this.foto.onload = function () {
      self.modo = 'foto';
      self.foto.classList.remove('oculto');
      self.video.classList.add('oculto');
      if (self.calibrado) { self.descalibrar(true); }
      self.entrarNoPalco();
    };
    this.foto.onerror = function () { self.mostrarTela('erro-camera', 'falha'); self.toast('Não foi possível abrir essa foto.'); };
    this.foto.src = this._fotoUrl;
  };

  Provador.prototype.alternarFonte = function () {
    if (this.modo === 'camera') { this.escolherFoto(); }
    else if (Compat.temCamera()) { this.iniciarCamera(); }
    else { this.escolherFoto(); }
  };

  Provador.prototype.entrarNoPalco = function () {
    this.mostrarTela(null);
    this.base.classList.remove('oculto');
    this.quadro.classList.remove('oculto');
    this.selo.classList.remove('oculto');
    this.btFoto.classList.remove('oculto');
    var self = this;
    requestAnimationFrame(function () {
      if (!self.pxPorCm) { self.escalaInicial(); self.centralizar(); }
      self.relayout();
      if (!self._dicaMostrada) {
        self._dicaMostrada = true;
        var tt = self.tamanhos.lista[self.idx];
        self.toast(!self.temMedidas() ? 'Medidas não informadas para este quadro: o tamanho é só ilustrativo.'
          : (!tt.orientacaoConfirmada ? 'Confira se o quadro é em pé ou deitado na foto do produto. Se precisar, toque em Girar.'
          : 'Arraste para mover. Use dois dedos para aumentar ou diminuir.'), 4500);
      }
    });
    this.atualizarTextos();
  };

  /* ---------- escala e posição ---------- */
  Provador.prototype.dimsPalco = function () { var r = this.palco.getBoundingClientRect(); return { w: r.width, h: r.height }; };

  Provador.prototype.dimsQuadroCm = function () {
    var t = this.tamanho();
    if (t && t.larguraCm) { return { w: t.larguraCm, h: t.alturaCm }; }
    // sem medidas: usa a proporção da foto (ou 2:3) com "cm" fictícios só para desenhar
    var p = this._caixa && this._img ? (this._caixa.w * this._img.naturalWidth) / (this._caixa.h * this._img.naturalHeight) : 2 / 3;
    return { w: 60 * p, h: 60 };
  };

  Provador.prototype.escalaInicial = function () {
    var p = this.dimsPalco(), d = this.dimsQuadroCm();
    var porAltura = (p.h * CONFIG.alturaInicialTela) / d.h, porLargura = (p.w * 0.7) / d.w;
    this.pxPorCm = Math.min(porAltura, porLargura);
  };

  Provador.prototype.centralizar = function () {
    var p = this.dimsPalco();
    this.cx = p.w / 2; this.cy = p.h * 0.46;
    this.render();
  };

  Provador.prototype.zoom = function (f, ancoraX, ancoraY) {
    if (this.calibrado) { this.toast('O tamanho está travado na escala real. Para mudar, toque em "Sair da escala".'); return; }
    if (!this.pxPorCm) { return; }
    var p = this.dimsPalco(), d = this.dimsQuadroCm();
    var min = 40 / Math.max(d.w, d.h), max = (Math.max(p.w, p.h) * 2.5) / Math.max(d.w, d.h);
    var novo = clamp(this.pxPorCm * f, min, max);
    if (ancoraX !== undefined) {
      var k = novo / this.pxPorCm;
      this.cx = ancoraX + (this.cx - ancoraX) * k; this.cy = ancoraY + (this.cy - ancoraY) * k;
    }
    this.pxPorCm = novo;
    this.render();
  };

  Provador.prototype.relayout = function () {
    if (!this.pxPorCm) { return; }
    var p = this.dimsPalco();
    if (this._ultPalco && (this._ultPalco.w !== p.w || this._ultPalco.h !== p.h)) {
      // mantém a posição relativa ao girar a tela; a calibração perde a validade
      this.cx = this.cx / this._ultPalco.w * p.w; this.cy = this.cy / this._ultPalco.h * p.h;
      if (this.calibrado) { this.descalibrar(false); this.toast('A tela mudou de tamanho: calibre a escala de novo.'); }
    }
    this._ultPalco = p;
    this.render();
  };

  Provador.prototype.render = function () {
    if (!this.pxPorCm) { return; }
    var d = this.dimsQuadroCm(), p = this.dimsPalco();
    var w = d.w * this.pxPorCm, hh = d.h * this.pxPorCm;
    // não deixa o quadro sumir da tela
    this.cx = clamp(this.cx, Math.min(0, p.w - w / 2) + Math.min(w / 2, 30), Math.max(p.w, w / 2) - Math.min(w / 2, 30));
    this.cy = clamp(this.cy, 30, p.h - 30);
    this.quadro.style.width = w + 'px';
    this.quadro.style.height = hh + 'px';
    this.quadro.style.transform = 'translate3d(' + (this.cx - w / 2) + 'px,' + (this.cy - hh / 2) + 'px,0)';
    this.renderQuadro();
  };

  Provador.prototype.renderQuadro = function () {
    var alvo;
    if (this.imgStatus === 'ok') {
      this.gerarTextura();
      if (this._texNoDom !== this.textura) {
        this.quadro.innerHTML = '';
        this.quadro.appendChild(this.textura);
        this.quadro.appendChild(this.elMedida);
        this._texNoDom = this.textura;
      }
      return this.atualizarTextos();
    }
    if (this._texNoDom !== 'contorno-' + this.imgStatus) {
      this.quadro.innerHTML = '';
      alvo = h('div', { class: 'contorno', text: this.imgStatus === 'carregando' ? 'Carregando o quadro…'
        : this.imgStatus === 'erro' ? 'Não foi possível carregar a imagem do quadro' : this.produto.nomeCurto });
      this.quadro.appendChild(alvo);
      this.quadro.appendChild(this.elMedida);
      this._texNoDom = 'contorno-' + this.imgStatus;
    }
    this.atualizarTextos();
  };

  Provador.prototype.atualizarTextos = function () {
    var t = this.tamanho();
    var med = t && t.larguraCm ? fmt(t.larguraCm) + ' × ' + fmt(t.alturaCm) + ' cm' : 'medidas não informadas';
    this.elSub.textContent = (t ? t.nome + ' · ' : '') + med;
    this.elMedida.textContent = med + (t && t.larguraCm ? ' (L × A)' : '');
    for (var i = 0; i < this.btTams.length; i++) {
      var ti = this.tamanhos.lista[i], sp = this.btTams[i].querySelector('span');
      if (ti.larguraCm) {
        var lw = this.girado ? ti.alturaCm : ti.larguraCm, la = this.girado ? ti.larguraCm : ti.alturaCm;
        sp.textContent = fmt(lw) + ' × ' + fmt(la) + ' cm';
      }
      this.btTams[i].classList.toggle('on', i === this.idx);
    }
    // selo de escala: nunca diz "escala real" sem calibração
    if (!this.temMedidas()) {
      this.selo.className = 'selo aprox' + (this.modo ? '' : ' oculto');
      this.selo.innerHTML = '';
      this.selo.appendChild(document.createTextNode('Medidas não disponíveis · tamanho ilustrativo'));
      this.selo.disabled = true;
    } else if (this.calibrado) {
      this.selo.className = 'selo real' + (this.modo ? '' : ' oculto');
      this.selo.innerHTML = ic(ICONE.check, 14) + '<span>Escala real · ' + this.refCal + '</span>';
      this.selo.disabled = false;
    } else {
      this.selo.className = 'selo aprox' + (this.modo ? '' : ' oculto');
      this.selo.innerHTML = '<span>Tamanho aproximado · <u>calibrar</u></span>';
      this.selo.disabled = false;
    }
    var semMed = !this.temMedidas();
    this.btEscala.disabled = semMed;
    this.btEscala.querySelector('span').textContent = this.calibrado ? 'Sair da escala' : 'Escala real';
    this.btEscala.classList.toggle('dest', this.calibrado);
    this.btMenos.disabled = this.calibrado; this.btMais.disabled = this.calibrado;
    var orig = this.tamanhos.lista[this.idx];
    this.btGirar.classList.toggle('oculto', !(orig && orig.larguraCm && !orig.orientacaoConfirmada));
    this.btFonte.querySelector('span').textContent = this.modo === 'camera' ? 'Usar foto' : 'Câmera';
    this.btFonte.querySelector('i').innerHTML = ic(this.modo === 'camera' ? ICONE.foto : ICONE.camera);
    if (this.modo !== 'camera' && !Compat.temCamera()) { this.btFonte.querySelector('span').textContent = 'Outra foto'; }
  };

  Provador.prototype.montarTamanhos = function () {
    var self = this, lista = this.tamanhos.lista;
    this.elTams.innerHTML = '';
    this.btTams = [];
    for (var i = 0; i < lista.length; i++) {
      (function (ix) {
        var t = lista[ix];
        var b = h('button', { class: 'tam', onclick: function () { self.trocarTamanho(ix); } },
          [h('b', { text: t.nome }), h('span', { text: t.larguraCm ? (fmt(t.larguraCm) + ' × ' + fmt(t.alturaCm) + ' cm') : 'medida não informada' })]);
        self.btTams.push(b); self.elTams.appendChild(b);
      })(i);
    }
    this.elTams.classList.toggle('oculto', lista.length < 2);
  };

  /* ---------- ProductSwitcher: testar outro quadro sem fechar a câmera ---------- */
  Provador.prototype.abrirTroca = function () {
    var self = this;
    if (this.calAtiva) { return; }
    if (!this._paginaProduto) { this._paginaProduto = this.produto; }
    var pag = this._paginaProduto;
    var itens = [{ url: pag.url, caminho: pag.caminho, nome: pag.nomeCurto, img: '', daPagina: true }]
      .concat(ProductDetector.relacionados());
    var og = document.querySelector('meta[property="og:image:secure_url"], meta[property="og:image"]');
    itens[0].img = og ? og.getAttribute('content') : '';
    var grade = h('div', { class: 'grade' });
    var folha;
    function fechar() { if (folha && folha.parentNode) { folha.parentNode.removeChild(folha); } }
    for (var i = 0; i < itens.length; i++) {
      (function (it) {
        var atual = it.caminho === self.produto.caminho;
        var c = h('button', { class: 'cartao' + (atual ? ' on' : '') }, [
          h('img', { src: it.img ? it.img.replace(/^\/\//, 'https://') : '', alt: '', loading: 'lazy' }),
          h('b', { text: it.nome }),
          h('small', { text: it.daPagina ? 'Quadro desta página' : (atual ? 'Na sua parede agora' : 'Toque para testar') })
        ]);
        c.addEventListener('click', function () {
          if (atual) { fechar(); return; }
          if (c.querySelector('.spin')) { return; }
          c.appendChild(h('div', { class: 'spin' }));
          var pedido = it.daPagina ? Promise.resolve(pag) : ProductDetector.buscar(it.url);
          pedido.then(function (produto) {
            if (self._fechado) { return; }
            fechar();
            self.trocarProduto(produto);
          }, function (e) {
            log('troca', e);
            var s = c.querySelector('.spin'); if (s) { c.removeChild(s); }
            self.toast('Não foi possível abrir esse quadro agora. Tente outro ou veja na loja.', 3500);
          });
        });
        grade.appendChild(c);
      })(itens[i]);
    }
    var vazio = itens.length < 2 ? h('p', { class: 'sub', text: 'Esta página não mostra outros quadros sugeridos. Veja todos na loja.' }) : null;
    folha = h('div', { class: 'folha', role: 'dialog', 'aria-label': 'Testar outro quadro' }, [
      h('div', { class: 'caixa' }, [
        h('h3', { text: 'Testar outro quadro' }),
        h('p', { class: 'sub', text: 'Quadros sugeridos nesta página. A escala e a posição continuam as mesmas, para você comparar.' }),
        vazio, grade,
        h('div', { class: 'rod' }, [
          h('button', { class: 'btn sec', text: 'Fechar', onclick: fechar }),
          h('a', { class: 'btn sec', href: '/quadros/', style: 'text-align:center;text-decoration:none', text: 'Ver todos na loja' })
        ])
      ])
    ]);
    folha.addEventListener('click', function (e) { if (e.target === folha) { fechar(); } });
    this.raiz.appendChild(folha);
  };

  Provador.prototype.trocarProduto = function (produto) {
    var anterior = this.tamanho();
    if (!this._paginaProduto) { this._paginaProduto = this.produto; }
    this.produto = produto;
    this.tamanhos = ProductDimensions.tamanhos(produto);
    // mantém o mesmo tamanho (ex.: Gigante) quando o outro quadro também tem
    this.idx = 0;
    for (var i = 0; i < this.tamanhos.lista.length; i++) {
      if (anterior && this.tamanhos.lista[i].nome === anterior.nome) { this.idx = i; break; }
    }
    // nada do quadro anterior é reaproveitado (medidas, foto, orientação)
    this.girado = false;
    this.textura = null; this._img = null; this._caixa = null; this._texChave = null; this._texNoDom = null;
    this.imgStatus = 'carregando';
    this.elTitulo.textContent = produto.nomeCurto;
    this.montarTamanhos();
    var naPagina = produto.caminho === this._paginaProduto.caminho;
    this.btLoja.classList.toggle('oculto', naPagina);
    this.btLoja.setAttribute('href', produto.url);
    // a escala (px por cm) é da parede, não do quadro: continua valendo
    this.render();
    this._avisoTroca = true;
    this.toast('Carregando ' + produto.nomeCurto + '…', 6000);
    this.prepararImagem();
  };

  Provador.prototype.avisarTroca = function () {
    if (!this._avisoTroca) { return; }
    this._avisoTroca = false;
    var t = this.tamanho(), produto = this.produto;
    var msg = produto.nomeCurto + (t && t.larguraCm ? ' · ' + t.nome + ' ' + fmt(t.larguraCm) + ' × ' + fmt(t.alturaCm) + ' cm' : ' · medidas não informadas');
    if (t && t.larguraCm && !this.tamanhos.lista[this.idx].orientacaoConfirmada) { msg += '. Confira se ele é em pé ou deitado; se precisar, toque em Girar.'; }
    if (this.imgStatus !== 'ok') { msg += '. Sem foto do quadro sozinho: mostrando o contorno.'; }
    this.toast(msg, 4000);
  };

  Provador.prototype.trocarTamanho = function (ix) {
    if (ix === this.idx) { return; }
    this.idx = ix;
    // a escala (px por cm) continua a mesma: o Gigante aparece maior na proporção certa
    this.render();
    var t = this.tamanho();
    if (t && t.larguraCm) { this.toast(t.nome + ': ' + fmt(t.larguraCm) + ' × ' + fmt(t.alturaCm) + ' cm', 1800); }
  };

  Provador.prototype.girar = function () {
    this.girado = !this.girado;
    this._texChave = null;
    this.render();
    this.toast('Orientação trocada. Confira na foto do produto se ele é em pé ou deitado.', 3000);
  };

  /* ---------- gestos: arrastar e pinça ---------- */
  Provador.prototype.ligarGestos = function () {
    var self = this, el = this.palco;
    function pos(e) { var r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function contar() { var n = 0; for (var k in self.ponteiros) { if (self.ponteiros.hasOwnProperty(k)) { n++; } } return n; }
    function dois() { var a = []; for (var k in self.ponteiros) { if (self.ponteiros.hasOwnProperty(k)) { a.push(self.ponteiros[k]); } } return a; }
    function iniciar() {
      var n = contar(), pts = dois();
      if (n === 1) { self.gesto = { tipo: 'arrastar', x0: pts[0].x, y0: pts[0].y, cx0: self.cx, cy0: self.cy }; }
      else if (n >= 2) {
        var a = pts[0], b = pts[1];
        self.gesto = { tipo: 'pinca', d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), px0: self.pxPorCm,
          mx0: (a.x + b.x) / 2, my0: (a.y + b.y) / 2, cx0: self.cx, cy0: self.cy, avisou: false };
      } else { self.gesto = null; }
    }
    this.on(el, 'pointerdown', function (e) {
      if (self.calAtiva || !self.modo || (e.target && e.target.closest && e.target.closest('.selo'))) { return; }
      if (e.pointerType === 'mouse' && e.button !== 0) { return; }
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
      self.ponteiros[e.pointerId] = pos(e);
      iniciar();
      e.preventDefault();
    });
    this.on(el, 'pointermove', function (e) {
      if (!self.ponteiros[e.pointerId] || !self.gesto) { return; }
      self.ponteiros[e.pointerId] = pos(e);
      var g = self.gesto, pts = dois();
      if (g.tipo === 'arrastar') {
        self.cx = g.cx0 + (pts[0].x - g.x0); self.cy = g.cy0 + (pts[0].y - g.y0);
      } else if (g.tipo === 'pinca' && pts.length >= 2) {
        var a = pts[0], b = pts[1];
        var d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (!self.calibrado) {
          var dq = self.dimsQuadroCm(), p = self.dimsPalco();
          var min = 40 / Math.max(dq.w, dq.h), max = (Math.max(p.w, p.h) * 2.5) / Math.max(dq.w, dq.h);
          var novo = clamp(g.px0 * d / g.d0, min, max), k = novo / g.px0;
          self.pxPorCm = novo;
          self.cx = g.mx0 + (g.cx0 - g.mx0) * k + (mx - g.mx0);
          self.cy = g.my0 + (g.cy0 - g.my0) * k + (my - g.my0);
        } else {
          self.cx = g.cx0 + (mx - g.mx0); self.cy = g.cy0 + (my - g.my0);
          if (!g.avisou && Math.abs(d / g.d0 - 1) > 0.15) { g.avisou = true; self.toast('Tamanho travado na escala real.'); }
        }
      }
      self.render();
      e.preventDefault();
    });
    function fim(e) {
      if (!self.ponteiros[e.pointerId]) { return; }
      delete self.ponteiros[e.pointerId];
      iniciar();
    }
    this.on(el, 'pointerup', fim);
    this.on(el, 'pointercancel', fim);
    // roda do mouse (computador)
    this.on(el, 'wheel', function (e) {
      if (self.calAtiva || !self.modo) { return; }
      e.preventDefault();
      var p = pos(e);
      self.zoom(e.deltaY < 0 ? 1.06 : 1 / 1.06, p.x, p.y);
    }, { passive: false });
    // impede o zoom da página no iOS durante a pinça
    this.on(el, 'gesturestart', function (e) { e.preventDefault(); });
    this.on(el, 'touchmove', function (e) { e.preventDefault(); }, { passive: false });
  };

  /* ---------- calibração por referência física ---------- */
  Provador.prototype.abrirCalibracao = function () {
    if (!this.temMedidas() || !this.modo) { return; }
    if (this.calibrado) { this.descalibrar(false); this.toast('Escala liberada: agora o tamanho é aproximado.'); return; }
    var self = this, p = this.dimsPalco();
    this.calAtiva = true;
    this.btFoto.classList.add('oculto');
    this.base.classList.add('oculto');
    this.quadro.classList.add('oculto');
    this.selo.classList.add('oculto');
    this.cal = { modo: 'a4', cx: p.w / 2, cy: p.h * 0.42, h: Math.min(p.h * 0.32, p.w * 0.6 * 29.7 / 21),
      p1: { x: p.w * 0.5, y: p.h * 0.2 }, p2: { x: p.w * 0.5, y: p.h * 0.62 } };

    var camada = h('div', { class: 'cal' });
    this.calCamada = camada;
    this.calRef = h('div', { class: 'ref' }, [h('div', { class: 'rot', html: 'A4<br>21×29,7' })]);
    this.calAlca = h('div', { class: 'alca' });
    this.calLinha = h('div', { class: 'linha' });
    this.calA1 = h('div', { class: 'alca' });
    this.calA2 = h('div', { class: 'alca' });
    camada.appendChild(this.calRef); camada.appendChild(this.calAlca);
    camada.appendChild(this.calLinha); camada.appendChild(this.calA1); camada.appendChild(this.calA2);

    var txt = h('p');
    var campo = h('input', { type: 'number', inputmode: 'decimal', min: '5', max: '1000', step: '0.5', placeholder: 'Ex.: 210', 'aria-label': 'Distância real em centímetros' });
    var linhaCampo = h('div', { class: 'campo' }, [campo, h('span', { text: 'cm' })]);
    var bA4 = h('button', { text: 'Folha A4' }), bMed = h('button', { text: 'Outra medida' });
    function modo(m) {
      self.cal.modo = m;
      bA4.classList.toggle('on', m === 'a4'); bMed.classList.toggle('on', m === 'medida');
      linhaCampo.classList.toggle('oculto', m !== 'medida');
      txt.textContent = m === 'a4'
        ? 'Encoste uma folha A4 em pé na parede, perto de onde vai o quadro. Arraste o retângulo para cima dela e ajuste o tamanho pela bolinha do canto até as bordas coincidirem.'
        : 'Arraste as duas bolinhas até as pontas de algo que você mediu na parede com trena (ex.: altura da porta) e digite a medida real.';
      self.desenharCal();
    }
    bA4.onclick = function () { modo('a4'); };
    bMed.onclick = function () { modo('medida'); };
    var aviso = this.modo === 'camera' ? h('p', { text: 'Depois de calibrar, fique no mesmo lugar: se você se aproximar ou se afastar da parede, a escala muda.' }) : null;
    var painel = h('div', { class: 'painel' }, [
      h('h3', { text: 'Calibrar a escala real' }),
      h('div', { class: 'seg' }, [bA4, bMed]), txt, linhaCampo, aviso,
      h('div', { class: 'linhaBtns' }, [
        h('button', { class: 'btn sec', text: 'Cancelar', onclick: function () { self.fecharCalibracao(); } }),
        h('button', { class: 'btn pri', text: 'Confirmar', onclick: function () {
          var pxPorCm;
          if (self.cal.modo === 'a4') { pxPorCm = self.cal.h / 29.7; self.refCal = 'folha A4'; }
          else {
            var cm = num(campo.value);
            if (!(cm >= 5 && cm <= 1000)) { self.toast('Digite a medida real em centímetros (entre 5 e 1000).'); campo.focus(); return; }
            var dpx = Math.hypot(self.cal.p2.x - self.cal.p1.x, self.cal.p2.y - self.cal.p1.y);
            if (dpx < 40) { self.toast('Afaste mais as bolinhas.'); return; }
            pxPorCm = dpx / cm; self.refCal = 'medida de ' + fmt(cm) + ' cm';
          }
          self.pxPorCm = pxPorCm; self.calibrado = true;
          self.fecharCalibracao();
          self.render();
          self.toast('Pronto! O quadro está em escala real. Agora é só arrastar.', 3200);
        } })
      ])
    ]);
    camada.appendChild(painel);
    this.palco.appendChild(camada);
    modo('a4');
    this.ligarGestosCal(camada);
  };

  Provador.prototype.desenharCal = function () {
    var c = this.cal; if (!c) { return; }
    var a4 = c.modo === 'a4';
    this.calRef.classList.toggle('oculto', !a4); this.calAlca.classList.toggle('oculto', !a4);
    this.calLinha.classList.toggle('oculto', a4); this.calA1.classList.toggle('oculto', a4); this.calA2.classList.toggle('oculto', a4);
    if (a4) {
      var w = c.h * 21 / 29.7;
      this.calRef.style.left = (c.cx - w / 2) + 'px'; this.calRef.style.top = (c.cy - c.h / 2) + 'px';
      this.calRef.style.width = w + 'px'; this.calRef.style.height = c.h + 'px';
      this.calAlca.style.left = (c.cx + w / 2) + 'px'; this.calAlca.style.top = (c.cy + c.h / 2) + 'px';
    } else {
      var dx = c.p2.x - c.p1.x, dy = c.p2.y - c.p1.y;
      this.calLinha.style.left = c.p1.x + 'px'; this.calLinha.style.top = (c.p1.y - 1.5) + 'px';
      this.calLinha.style.width = Math.hypot(dx, dy) + 'px';
      this.calLinha.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
      this.calA1.style.left = c.p1.x + 'px'; this.calA1.style.top = c.p1.y + 'px';
      this.calA2.style.left = c.p2.x + 'px'; this.calA2.style.top = c.p2.y + 'px';
    }
  };

  Provador.prototype.ligarGestosCal = function (camada) {
    var self = this, g = null, pts = {};
    function pos(e) { var r = self.palco.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function lista() { var a = []; for (var k in pts) { if (pts.hasOwnProperty(k)) { a.push(pts[k]); } } return a; }
    camada.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.painel')) { return; }
      var p = pos(e), c = self.cal;
      pts[e.pointerId] = p;
      try { camada.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
      var l = lista();
      if (c.modo === 'a4') {
        if (l.length >= 2) {
          g = { t: 'pinca', d0: Math.max(10, Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y)), h0: c.h };
        } else {
          var w = c.h * 21 / 29.7;
          var nx = c.cx + w / 2, ny = c.cy + c.h / 2;
          g = Math.hypot(p.x - nx, p.y - ny) < 34 ? { t: 'canto' } : { t: 'mover', x0: p.x, y0: p.y, cx0: c.cx, cy0: c.cy };
        }
      } else {
        var d1 = Math.hypot(p.x - c.p1.x, p.y - c.p1.y), d2 = Math.hypot(p.x - c.p2.x, p.y - c.p2.y);
        g = { t: d1 < d2 ? 'p1' : 'p2' };
      }
      e.preventDefault();
    });
    camada.addEventListener('pointermove', function (e) {
      if (!g || !pts[e.pointerId]) { return; }
      var p = pos(e), c = self.cal, P = self.dimsPalco();
      pts[e.pointerId] = p;
      if (g.t === 'mover') { c.cx = g.cx0 + p.x - g.x0; c.cy = g.cy0 + p.y - g.y0; }
      else if (g.t === 'canto') {
        c.h = clamp(Math.max(2 * Math.abs(p.y - c.cy), 2 * Math.abs(p.x - c.cx) * 29.7 / 21), 30, P.h * 1.5);
      } else if (g.t === 'pinca') {
        var l = lista(); if (l.length >= 2) { c.h = clamp(g.h0 * Math.max(10, Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y)) / g.d0, 30, P.h * 1.5); }
      } else if (g.t === 'p1') { c.p1 = p; } else if (g.t === 'p2') { c.p2 = p; }
      self.desenharCal();
      e.preventDefault();
    });
    function fim(e) { delete pts[e.pointerId]; if (!lista().length) { g = null; } }
    camada.addEventListener('pointerup', fim);
    camada.addEventListener('pointercancel', fim);
  };

  Provador.prototype.fecharCalibracao = function () {
    this.calAtiva = false;
    if (this.modo) { this.btFoto.classList.remove('oculto'); }
    if (this.calCamada && this.calCamada.parentNode) { this.calCamada.parentNode.removeChild(this.calCamada); }
    this.calCamada = null; this.cal = null;
    this.base.classList.remove('oculto');
    this.quadro.classList.remove('oculto');
    this.selo.classList.remove('oculto');
    this.atualizarTextos();
  };

  Provador.prototype.descalibrar = function (avisar) {
    this.calibrado = false; this.refCal = '';
    this.atualizarTextos();
    if (avisar) { this.toast('Imagem nova: a escala voltou a ser aproximada. Calibre de novo para ver em escala real.', 3500); }
  };

  /* ---------- ScreenshotManager: foto da simulação (tudo no aparelho) ---------- */
  Provador.prototype.tirarFoto = function () {
    var self = this;
    if (!this.modo || this.calAtiva || this._fotografando) { return; }
    var fonte = this.modo === 'camera' ? this.video : this.foto;
    var fw = this.modo === 'camera' ? fonte.videoWidth : fonte.naturalWidth;
    var fh = this.modo === 'camera' ? fonte.videoHeight : fonte.naturalHeight;
    if (!fw || !fh) { this.toast('A imagem ainda não carregou. Tente de novo em instantes.'); return; }
    this._fotografando = true;
    var P = this.dimsPalco();
    // mesmo enquadramento da tela (object-fit: cover)
    var s = Math.max(P.w / fw, P.h / fh);
    var vw = P.w / s, vh = P.h / s, vx = (fw - vw) / 2, vy = (fh - vh) / 2;
    var k = Math.min(1, 2000 / Math.max(vw, vh));
    var c = document.createElement('canvas');
    c.width = Math.round(vw * k); c.height = Math.round(vh * k);
    var ctx = c.getContext('2d');
    var esc = c.width / P.w;   // pixels da foto por pixel da tela
    try {
      ctx.drawImage(fonte, vx, vy, vw, vh, 0, 0, c.width, c.height);
      var d = this.dimsQuadroCm();
      var qw = d.w * this.pxPorCm * esc, qh = d.h * this.pxPorCm * esc;
      var qx = (this.cx * esc) - qw / 2, qy = (this.cy * esc) - qh / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24 * esc; ctx.shadowOffsetY = 12 * esc;
      if (this.imgStatus === 'ok' && this.textura) {
        ctx.drawImage(this.textura, qx, qy, qw, qh);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(qx, qy, qw, qh);
        ctx.shadowColor = 'transparent';
        ctx.setLineDash([8 * esc, 6 * esc]); ctx.lineWidth = 2 * esc; ctx.strokeStyle = '#fff';
        ctx.strokeRect(qx, qy, qw, qh);
      }
      ctx.restore();
    } catch (e) {
      this._fotografando = false;
      log('foto', e);
      this.toast('Não foi possível montar a foto. Use o print da tela do celular.', 4000);
      return;
    }
    this.flash.classList.add('on');
    setTimeout(function () { self.flash.classList.remove('on'); }, 60);
    var nome = 'maperia-na-minha-parede.jpg';
    function pronto(blob) {
      self._fotografando = false;
      if (!blob) { self.toast('Não foi possível salvar a foto. Use o print da tela do celular.', 4000); return; }
      self.mostrarPrevia(blob, nome);
    }
    try {
      if (c.toBlob) { c.toBlob(pronto, 'image/jpeg', 0.9); }
      else {
        var bin = atob(c.toDataURL('image/jpeg', 0.9).split(',')[1]), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) { arr[i] = bin.charCodeAt(i); }
        pronto(new Blob([arr], { type: 'image/jpeg' }));
      }
    } catch (e2) {
      // canvas "contaminado" (imagem de outro domínio sem CORS): não dá para exportar
      this._fotografando = false;
      log('foto export', e2);
      this.toast('Por segurança do navegador, esta foto não pode ser salva. Use o print da tela do celular.', 5000);
    }
  };

  Provador.prototype.mostrarPrevia = function (blob, nome) {
    var self = this;
    if (this._snapUrl) { URL.revokeObjectURL(this._snapUrl); }
    this._snapUrl = URL.createObjectURL(blob);
    var arquivo = null;
    try { arquivo = new File([blob], nome, { type: 'image/jpeg' }); } catch (e) { arquivo = null; }
    var podeCompartilhar = !!(arquivo && navigator.canShare && navigator.share && navigator.canShare({ files: [arquivo] }));
    var t = this.tamanho();
    var dica = Compat.ios() && !podeCompartilhar
      ? 'Toque e segure na foto para salvar no celular.'
      : 'A foto fica só no seu celular. Nada é enviado para a loja.';
    var previa = h('div', { class: 'previa', role: 'dialog', 'aria-label': 'Foto da simulação' }, [
      h('h3', { text: 'Sua simulação' + (t && t.nome ? ' · ' + t.nome : '') }),
      h('div', { class: 'img' }, [h('img', { src: this._snapUrl, alt: 'Foto da simulação do quadro na parede' })]),
      h('p', { class: 'dica', text: dica }),
      h('div', { class: 'linhaBtns' }, [
        h('button', { class: 'btn sec', text: 'Voltar', onclick: function () { fechar(); } }),
        h('button', { class: 'btn pri', html: 'Salvar foto', onclick: function () { salvar(); } })
      ])
    ]);
    function fechar() { if (previa.parentNode) { previa.parentNode.removeChild(previa); } }
    function baixar() {
      var a = document.createElement('a');
      a.href = self._snapUrl; a.download = nome; a.rel = 'noopener';
      self.root.appendChild(a); a.click(); self.root.removeChild(a);
    }
    function salvar() {
      if (podeCompartilhar) {
        navigator.share({ files: [arquivo], title: 'Meu quadro Maperia' }).then(null, function (e) {
          if (e && e.name === 'AbortError') { return; }   // a pessoa só fechou o menu
          baixar();
        });
      } else if (Compat.ios()) {
        self.toast('Toque e segure na foto e escolha "Salvar na Fotos".', 3500);
      } else { baixar(); }
    }
    this.raiz.appendChild(previa);
  };

  Provador.prototype.toast = function (txt, ms) {
    var el = this.toastEl, self = this;
    el.textContent = txt;
    el.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(function () { el.classList.remove('on'); }, ms || 2600);
  };

  /* =====================================================================
   * Botão na página do produto
   * ===================================================================== */
  function corDaLoja() {
    var b = document.querySelector('.js-addtocart.btn-primary, .js-addtocart');
    if (b) {
      var c = getComputedStyle(b).backgroundColor;
      var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || '');
      if (m && (m[4] === undefined || num(m[4]) > 0.5)) {
        var hex = '#';
        for (var i = 1; i <= 3; i++) { var x = parseInt(m[i], 10).toString(16); hex += x.length < 2 ? '0' + x : x; }
        if (hex !== '#ffffff' && hex !== '#000000') { return hex; }
      }
    }
    return CONFIG.corPadrao;
  }

  function inserirBotao() {
    if (document.getElementById('mprv-botao')) { return true; }
    var form = document.getElementById('product_form');
    var comprar = form ? form.querySelector('.js-addtocart') : document.querySelector('.js-addtocart');
    var ancora = null, depois = true;
    if (comprar) { ancora = (comprar.closest && comprar.closest('.form-row')) || comprar; }
    else if (form) { ancora = form; }
    else {
      var gal = document.querySelector('.js-swiper-product');
      if (gal) { ancora = gal.parentNode; }
    }
    if (!ancora || !ancora.parentNode) { return false; }
    var cor = corDaLoja();
    var host = h('div', { id: 'mprv-botao' });
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.appendChild(h('style', { text: cssBotaoPagina(cor) }));
    var bt = h('button', { class: 'b', type: 'button', 'aria-label': 'Ver na minha parede: experimente esse quadro no seu ambiente usando a câmera do celular' }, [
      h('span', { class: 'i', html: ic(ICONE.parede, 22, '#fff') }),
      h('span', null, [
        h('span', { class: 't', text: 'VER NA MINHA PAREDE' }),
        h('span', { class: 's', text: 'Experimente esse quadro no seu ambiente usando a câmera do celular.' })
      ])
    ]);
    bt.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();   // não envia o formulário de compra
      abrirProvador(cor);
    });
    root.appendChild(bt);
    if (depois) { ancora.parentNode.insertBefore(host, ancora.nextSibling); }
    return true;
  }

  function abrirProvador(cor) {
    if (API.atual) { return; }
    try {
      var produto = ProductDetector.ler();
      var tamanhos = ProductDimensions.tamanhos(produto);
      var p = new Provador(produto, tamanhos, cor || corDaLoja());
      API.atual = p;
      p.abrir();
    } catch (e) {
      log('erro ao abrir', e);
      API.atual = null;
      var host = document.getElementById('mprv-provador');
      if (host && host.parentNode) { host.parentNode.removeChild(host); }
      document.documentElement.style.overflow = '';
      alert('Não foi possível abrir o provador agora. Tente de novo em instantes.');
    }
  }

  /* =====================================================================
   * Diagnóstico (para o modo Preview do GTM e para os testes)
   * Uso no console: __maperiaProvador.diagnostico()
   * ===================================================================== */
  API.diagnostico = function () {
    var produto = ProductDetector.ler();
    var t = ProductDimensions.tamanhos(produto);
    var out = {
      paginaDeProduto: ProductDetector.ehPaginaDeProduto(),
      produto: { id: produto.id, nome: produto.nome, caminho: produto.caminho, naConfiguracao: !!CONFIG.produtos[produto.caminho] },
      opcaoDeTamanho: t.opcao,
      tamanhos: t.lista,
      selecionadoNaPagina: t.lista[ProductDimensions.selecionadoNaPagina(t)] || null,
      imagensDaGaleria: ProductImageManager.urlsDaGaleria().length,
      botaoInserido: !!document.getElementById('mprv-botao'),
      camera: Compat.temCamera(),
      navegadorInterno: Compat.navegadorInterno()
    };
    return ProductImageManager.acharIsolada().then(function (r) {
      out.fotoIsolada = r.achou ? { url: r.item.grande, caixa: r.caixa } : (r.cors ? 'bloqueada por CORS' : 'não encontrada');
      return out;
    });
  };
  API.abrir = function () { abrirProvador(); };
  API.config = CONFIG;

  /* =====================================================================
   * Início
   * ===================================================================== */
  function liberadoNesteAparelho() {
    if (!CONFIG.modoTeste) { return true; }
    var q = location.search || '', chave = 'mprv-teste', ok = false;
    try {
      if (/[?&]provador=sair\b/.test(q)) { sessionStorage.removeItem(chave); return false; }
      if (/[?&]provador=teste\b/.test(q)) { sessionStorage.setItem(chave, '1'); }
      ok = sessionStorage.getItem(chave) === '1';
    } catch (e) { ok = /[?&]provador=teste\b/.test(q); }
    return ok;
  }
  API.modoTeste = CONFIG.modoTeste;

  function iniciar() {
    try {
      if (!liberadoNesteAparelho()) { return; }
      if (!ProductDetector.ehPaginaDeProduto()) { return; }
      if (inserirBotao()) { return; }
      // o formulário ainda não apareceu: observa por no máximo 8 s e desliga
      var obs = new MutationObserver(function () { if (inserirBotao()) { obs.disconnect(); } });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () { obs.disconnect(); }, 8000);
    } catch (e) { log('erro ao iniciar', e); }
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', iniciar); }
  else { iniciar(); }
})();
