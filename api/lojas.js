// Consulta de estabelecimentos: somente leitura, sem checkout, pagamentos ou cookies.
const API = 'https://prd-dominos.alphacode.com.br/apiV1/getStore/';
const clean = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const first = (...values) => values.find(v => v !== undefined && v !== null && v !== '') ?? '';
function normalize(payload) {
  const data = payload?.data ?? payload;
  const list = [data?.stores, data?.storeList, data?.store, data?.list, data?.items,
    data?.results, data?.availableStores, data?.deliveryStores, data, payload?.stores]
    .find(Array.isArray);
  if (!list) {
    if (data && typeof data === 'object' &&
        (data.storeId || data.id) && (data.name || data.storeName)) return normalize({data:[data]});
    return null;
  }
  return list.filter(x => x && typeof x === 'object').slice(0,100).map(x => {
    const a = x.address && typeof x.address === 'object' ? x.address : {};
    const address = typeof x.address === 'string' ? x.address : [
      first(x.street, a.street, x.logradouro), first(x.number,a.number),
      first(x.neighborhood,a.neighborhood), first(x.city,a.city), first(x.state,a.state)
    ].filter(Boolean).join(', ');
    return {
      id:clean(first(x.storeId,x.id,x.code,x.storeCode),50),
      name:clean(first(x.name,x.storeName,x.title,x.tradeName,'Loja')),
      address:clean(address || first(x.fullAddress,x.storeAddress,'Endereço não informado'),260),
      status:clean(first(x.status,x.storeStatus,''),60)
    };
  });
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
    if(!stores) return res.status(502).json({error:'A API respondeu, mas o formato da lista de lojas não foi reconhecido.'});
    return res.status(200).json({stores,zip:{cep,street:zip.logradouro,neighborhood:zip.bairro,city:zip.localidade,state:zip.uf}});
  } catch(e) {
    return res.status(502).json({error:e.name==='AbortError'?'Tempo limite ao consultar as lojas.':'Falha ao consultar as lojas: '+clean(e.message,120)});
  } finally {clearTimeout(timeout)}
};
module.exports.normalize=normalize;
