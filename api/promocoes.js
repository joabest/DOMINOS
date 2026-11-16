// Promoções oficiais em modo de consulta. Não executa checkout.
const BASE='https://prd-dominos.alphacode.com.br/apiV1/';
const text=(v,max=250)=>String(v??'').slice(0,max);
const validImage=v=>typeof v==='string'&&/^https:\/\//i.test(v)?v:null;
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Método não permitido'});
 const storeId=String(req.query.storeId??'');
 const deliveryType=req.query.deliveryType==='TAKEOUT'?'TAKEOUT':'DELIVERY';
 if(!/^\d{1,8}$/.test(storeId))return res.status(400).json({error:'ID da loja inválido'});
 const ctrl=new AbortController();
 const timeout=setTimeout(()=>ctrl.abort(),10000);
 try{
  const query=new URLSearchParams({storeId,deliveryType});
  const request=await fetch(BASE+'getBestCoupons/?'+query,{headers:{Accept:'application/json',appplatform:'web',deviceid:'alphacode'},signal:ctrl.signal});
  if(!request.ok)return res.status(502).json({error:'Serviço de promoções indisponível (HTTP '+request.status+').'});
  const payload=await request.json();
  if(payload?.status==='error')return res.status(502).json({error:text(payload.message||'Consulta recusada',180)});
  const items=Array.isArray(payload?.data)?payload.data:[];
  const promotions=items.filter(p=>p&&typeof p==='object').slice(0,80).map(p=>({
   id:text(p.id,30),
   name:text(p.description||p.name||'Promoção',180),
   image:validImage(p.image),
   minimumPrice:typeof p.minimumPrice==='number'&&Number.isFinite(p.minimumPrice)&&p.minimumPrice>=0?p.minimumPrice:null
  }));
  return res.status(200).json({promotions,storeId});
 }catch(error){return res.status(502).json({error:error.name==='AbortError'?'Tempo limite na consulta de promoções.':'Não foi possível consultar as promoções.'});}
 finally{clearTimeout(timeout)}
};
