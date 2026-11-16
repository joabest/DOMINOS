// Catálogo de consulta: leitura somente. Não cria pedidos nem processa pagamentos.
const BASE = 'https://prd-dominos.alphacode.com.br/apiV1/';
const str = (v,n=150)=>String(v??'').slice(0,n);
const first=(...xs)=>xs.find(x=>x!==null && x!==undefined && x!=='');
const price = x => {
  if(x==null||x==='')return null;
  const n=Number(typeof x==='string'?x.replace(/[^0-9.,-]/g,'').replace(',','.'):x);
  return Number.isFinite(n) && n>=0 && n<100000 ? n : null;
};
const imageUrl=x=>{
 const read=(value,depth=0)=>{
  if(!value||depth>4)return null;
  if(Array.isArray(value))return value.map(v=>read(v,depth+1)).find(Boolean)||null;
  if(typeof value==='object'){
   const keys=['url','src','imageUrl','imageURL','imagePath','image','path','fullUrl','original','large','medium','thumbnail','desktop','mobile','file'];
   return keys.map(k=>read(value[k],depth+1)).find(Boolean)||null;
  }
  const uri=str(value,1200).trim();
  if(/^https:\/\//i.test(uri))return uri;
  if(/^\/\//.test(uri))return 'https:'+uri;
  return null;
 };
 return read(x);
};
const pickImage=obj=>{
 const keys=['imageUrl','imageURL','productImage','productImageUrl','imagePath','image','images','picture','pictureUrl','photo','photoUrl','thumbnail','thumbnailUrl','banner','bannerUrl','media','photos','imageDesktop','desktopImage'];
 return keys.map(k=>imageUrl(obj[k])).find(Boolean)||null;
};
function parseCatalog(payload){
 const products=[],seen=new Set();let nodes=0;
 function walk(obj,category='',depth=0){
  if(!obj||typeof obj!=='object'||depth>8||++nodes>6000)return;
  if(Array.isArray(obj)){for(const item of obj.slice(0,350))walk(item,category,depth+1);return;}
  const name=first(obj.productName,obj.name,obj.title,obj.descriptionName,obj.itemName);
  const p=first(obj.price,obj.salePrice,obj.finalPrice,obj.value,obj.unitPrice,obj.priceFrom);
  const id=first(obj.productId,obj.itemId,obj.sku,obj.id,obj.code);
  const children=Object.entries(obj).filter(([k,v])=>v&&typeof v==='object'&&!/^(images|image|details|options|sizes|prices|ingredients|additionals|addons|variations|variants|configuration|customizations|payment)$/i.test(k));
  const isProduct=Boolean(name && (p!==undefined||obj.productId!==undefined||obj.sku!==undefined||obj.itemId!==undefined) && (id!==undefined||p!==undefined));
  if(isProduct){
   const key=str(id??name)+'|'+str(name);
   if(!seen.has(key)){
    seen.add(key);
    const productImage=pickImage(obj);
    products.push({id:str(id??key,80),name:str(name,160),category:str(first(obj.categoryName,obj.category?.name,category,'Cardápio'),85),description:str(first(obj.description,obj.subtitle,''),330),price:price(p),image:productImage});
   }
   return;
  }
  const nextCategory=str(first(obj.categoryName,obj.name,obj.title,category),90);
  for(const [key,value] of children)walk(value,/(category|group|section|menu)/i.test(key)?nextCategory:category,depth+1);
 }
 walk(payload?.data??payload);
 return products.slice(0,300);
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Método não permitido'});
 const storeId=String(req.query.storeId??'');
 const deliveryType=req.query.deliveryType==='TAKEOUT'?'TAKEOUT':'DELIVERY';
 if(!/^\d{1,8}$/.test(storeId))return res.status(400).json({error:'ID da loja inválido'});
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),9000);
 try{
  const headers={Accept:'application/json',appplatform:'web',deviceid:'alphacode'};
  const paths=[
   'getMenu/?storeId='+encodeURIComponent(storeId),
   'getThematicMenu/?storeId='+encodeURIComponent(storeId)+'&deliveryType='+deliveryType
  ];
  const results=await Promise.all(paths.map(async path=>{
   try{
    const r=await fetch(BASE+path,{headers,signal:controller.signal});
    if(!r.ok)return {error:'HTTP '+r.status};
    const payload=await r.json();
    return {products:parseCatalog(payload),shape:{keys:Object.keys(payload||{}).slice(0,12),dataKeys:Object.keys(payload?.data||{}).slice(0,12)}};
   }catch(e){return {error:e.name==='AbortError'?'Tempo limite':'Resposta não disponível'};}
  }));
  const products=[],seen=new Set();
  for(const result of results)for(const item of result.products||[]){const key=item.id+'|'+item.name;if(!seen.has(key)){seen.add(key);products.push(item)}}
  return res.status(200).json({storeId,products,source:'Consulta do cardápio',availability:results.map((r,i)=>({type:i?'thematic':'menu',count:r.products?.length??0,error:r.error??null,shape:r.products?.length?undefined:r.shape}))});
 }finally{clearTimeout(timeout);}
};
module.exports.parseCatalog=parseCatalog;
