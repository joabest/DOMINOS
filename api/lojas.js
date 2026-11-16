// Consulta de estabelecimentos: somente leitura, sem checkout, pagamentos ou cookies.
const API = 'https://prd-dominos.alphacode.com.br/apiV1/getStore/';
const clean = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const first = (...values) => values.find(v => v !== undefined && v !== null && v !== '') ?? '';
function normalize(payload) {
  const firstValue = (...values) => values.find(v => v !== undefined && v !== null && v !== '') ?? '';
  const seen = new Set();
  const candidates = [];
  let visited = 0;

  function looksLikeStore(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    const id = firstValue(o.storeId, o.storeID, o.store_id, o.idStore, o.id, o.code, o.storeCode);
    const name = firstValue(o.storeName, o.name, o.tradeName, o.title, o.fantasyName);
    const location = firstValue(o.address, o.storeAddress, o.fullAddress, o.street, o.logradouro, o.location);
    return Boolean((id && (name || location)) || (name && location));
  }

  function walk(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 7 || ++visited > 3000 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 200)) walk(item, depth + 1);
      return;
    }
    if (looksLikeStore(node)) {
      candidates.push(node);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (/^(headers|request|config|metadata|filters|payment|cart|menu|products|categories)$/i.test(key)) continue;
      if (value && typeof value === 'object') walk(value, depth + 1);
    }
  }

  const data = payload?.data ?? payload;
  // O provedor devolve modalidades separadas: não eliminar a mesma loja de
  // delivery e takeout, pois taxas, horário e disponibilidade podem diferir.
  if (data && typeof data === 'object' && !Array.isArray(data) &&
      (Array.isArray(data.delivery) || Array.isArray(data.takeout))) {
    const items = [
      ...(data.delivery || []).map(x => ({...x, deliveryType:'DELIVERY'})),
      ...(data.takeout || []).map(x => ({...x, deliveryType:'TAKEOUT'}))
    ];
    return items.filter(x => x && x.id != null).slice(0,100).map(x => ({
      id:clean(x.id,50),
      name:clean(x.name || 'Loja'),
      address:clean([x.street,x.number,x.neighborhood,x.city,x.state].filter(Boolean).join(', '),260),
      deliveryType:x.deliveryType,
      isOpen:x.isOpen === true,
      isActive:x.isActive === true,
      available:x.status === true,
      deliveryFee:Number.isFinite(Number(x.deliveryFee)) ? Number(x.deliveryFee) : null,
      openTime:clean(x.hoursOperation?.openTime || '',10),
      closeTime:clean(x.hoursOperation?.closeTime || '',10),
      distance:Number.isFinite(Number(x.distance)) ? Number(x.distance) : null
    }));
  }
  // Uma lista vazia é uma resposta válida: nenhuma loja disponível.
  if (Array.isArray(data) && data.length === 0) return [];
  walk(data);
  if (!candidates.length) return null;

  const unique = new Set();
  return candidates.slice(0, 100).map(x => {
    const a = x.address && typeof x.address === 'object' ? x.address : {};
    const location = x.location && typeof x.location === 'object' ? x.location : {};
    const address = typeof x.address === 'string' ? x.address : [
      firstValue(x.street, a.street, location.street, x.logradouro),
      firstValue(x.number, a.number, location.number),
      firstValue(x.neighborhood, a.neighborhood, location.neighborhood),
      firstValue(x.city, a.city, location.city),
      firstValue(x.state, a.state, location.state)
    ].filter(Boolean).join(', ');
    return {
      id: clean(firstValue(x.storeId, x.storeID, x.store_id, x.idStore, x.id, x.code, x.storeCode), 50),
      name: clean(firstValue(x.storeName, x.name, x.tradeName, x.fantasyName, x.title, 'Loja')),
      address: clean(address || firstValue(x.fullAddress, x.storeAddress, 'Endereço não informado'), 260),
      status: clean(firstValue(x.status, x.storeStatus, ''), 60)
    };
  }).filter(x => {
    const key = x.id || x.name + '|' + x.address;
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });
}
function responseShape(payload) {
  const data = payload?.data ?? payload;
  return {
    rootKeys: payload && !Array.isArray(payload) && typeof payload === 'object' ? Object.keys(payload).slice(0, 15) : [],
    dataType: Array.isArray(data) ? 'array' : typeof data,
    dataKeys: data && !Array.isArray(data) && typeof data === 'object' ? Object.keys(data).slice(0, 20) : []
  };
}
module.exports = async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method !== 'GET') return res.status(405).json({error:'Método não permitido'});
  const cep=clean(req.query.cep,20).replace(/\D/g,'');
  const number=clean(req.query.number,20);
  if(!/^\d{8}$/.test(cep)) return res.status(400).json({error:'CEP inválido'});
  if(!number || !/^[\p{L}\p{N}\s/-]{1,20}$/u.test(number))
    return res.status(400).json({error:'Informe o número do endereço (ou S/N).'});
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try {
    // O servidor resolve o CEP, evitando confiar no bairro/cidade enviados pelo browser.
    const zipResp=await fetch(`https://viacep.com.br/ws/${cep}/json/`,{signal:controller.signal});
    if(!zipResp.ok) throw Error('Falha ao consultar CEP');
    const zip=await zipResp.json();
    if(zip.erro) return res.status(404).json({error:'CEP não encontrado'});
    const query=new URLSearchParams({
      zipCode:cep, city:zip.localidade||'',state:zip.uf||'',
      neighborhood:zip.bairro||'', street:zip.logradouro||'',number
    });
    const upstream=await fetch(`${API}?${query}`,{
      headers:{Accept:'application/json','appplatform':'web','deviceid':'alphacode'},
      signal:controller.signal,
    });
    if(!upstream.ok) return res.status(502).json({error:`Serviço de lojas retornou HTTP ${upstream.status}.`});
    const payload=await upstream.json();
    if(payload?.status === 'error')
      return res.status(502).json({error:clean(payload.message||'Consulta de lojas recusada',200)});
    const stores=normalize(payload);
    if(!stores) return res.status(502).json({error:'A API respondeu, mas não há uma lista de lojas identificável.', shape:responseShape(payload)});
    return res.status(200).json({stores,zip:{cep,street:zip.logradouro,neighborhood:zip.bairro,city:zip.localidade,state:zip.uf}});
  } catch(e) {
    return res.status(502).json({error:e.name==='AbortError'?'Tempo limite ao consultar as lojas.':'Falha ao consultar as lojas: '+clean(e.message,120)});
  } finally {clearTimeout(timeout)}
};
module.exports.normalize=normalize;
