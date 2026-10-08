import {createPublicClient,createWalletClient,predictEntityKey,ENTITY_EVENTS_ABI} from '@arkiv-network/sdk';
import {tiramisu} from '@arkiv-network/sdk/chains';
import {custom,decodeFunctionData,decodeAbiParameters,encodeAbiParameters,encodeEventTopics,parseAbi,parseAbiParameters,hexToBytes,parseTransaction,keccak256,recoverTransactionAddress} from 'viem';
const execute=parseAbi(['function execute((uint8 operation, bytes operationData)[] ops) external returns (bytes32[] keys)']);
const nonceAbi=parseAbi(['function entityNonce(address owner) external view returns(uint64)']);
const tuple='(bytes32 name,uint8 typeId,bytes value)[]';
const params={1:parseAbiParameters(`(uint128 salt,uint64 expiresAt,uint64 minLifetime,uint8 creationFlags,${tuple} attributes)`),2:parseAbiParameters(`(bytes32 entityKey,${tuple} mutations)`),3:parseAbiParameters('(bytes32 entityKey,uint64 expiresAt,uint64 minLifetime)'),4:parseAbiParameters('(bytes32 entityKey,address newOwner)'),5:parseAbiParameters('(bytes32 entityKey)')};
const names={1:'bool',2:'i32',3:'u64',4:'u256',5:'dec',6:'bytes32',7:'bytes',8:'str',9:'addr',10:'key'};
const text=hex=>new TextDecoder().decode(hexToBytes(hex)).replace(/\0+$/,'');
const hex=value=>'0x'+BigInt(value).toString(16);
let globalTx=0;
export function makeFixture(owner='0x1111111111111111111111111111111111111111'){
 const fixture={head:4096n,owner,balance:10n**18n,entities:new Map(),nonces:new Map(),sends:[],methods:[],queries:[],receipts:new Map(),transactions:new Map(),staleNonce:false,missingAfterTransfer:false};
 function decodeAttribute(cell){return{name:text(cell.name),type:names[cell.typeId],value:[7,8].includes(cell.typeId)?(cell.typeId===7?cell.value:text(cell.value)):cell.typeId===1?BigInt(cell.value)!==0n:cell.typeId===2?Number(BigInt.asIntN(32,BigInt(cell.value))):cell.value};}
 async function request({method,params:arguments_=[]}){
  fixture.methods.push(method);
  if(method==='eth_chainId')return'0x7614d1';
  if(method==='eth_blockNumber')return hex(fixture.head);
  if(method==='eth_getBalance')return hex(fixture.balance);
  if(method==='eth_getTransactionCount')return hex((arguments_[1]==='pending'?fixture.pendingNonce:fixture.latestNonce)??fixture.sends.length);
  if(method==='eth_gasPrice'||method==='eth_maxPriorityFeePerGas')return'0x1';
  if(method==='eth_fillTransaction')throw{code:-32601,message:'Optional method unavailable in local fixture'};
  if(method==='eth_estimateGas')return'0x186a0';
  if(method==='eth_getBlockByNumber'){
   const number=arguments_[0]==='latest'?fixture.head:BigInt(arguments_[0]);
   return{number:hex(number),hash:'0x'+(number===0n?'ab':'aa').repeat(32),baseFeePerGas:'0x1',gasLimit:'0x1c9c380',gasUsed:'0x1',timestamp:'0x6553f100',transactions:[...fixture.transactions.values()].filter(tx=>BigInt(tx.blockNumber)===number).map(tx=>tx.hash)};
  }
  if(method==='arkiv_getBlockTiming')return{current_block:hex(fixture.head),current_block_time:1700000000,duration:2};
  if(method==='eth_call'){const decoded=decodeFunctionData({abi:nonceAbi,data:arguments_[0].data});return encodeAbiParameters(parseAbiParameters('uint64'),[fixture.nonces.get(decoded.args[0].toLowerCase())??0n]);}
  if(method==='eth_getTransactionReceipt')return fixture.hideReceipts?null:fixture.receipts.get(arguments_[0]);
  if(method==='eth_getTransactionByHash')return fixture.transactions.get(arguments_[0]);
  if(method==='arkiv_query'){
   const[query,options]=arguments_;fixture.queries.push(arguments_);
   if(fixture.cursorExpiresOnce&&options.cursor){fixture.cursorExpiresOnce=false;throw{code:-32005,message:'Cursor expired'};}
   if(options.atBlock&&BigInt(options.atBlock)!==fixture.head)throw{code:-32006,message:'Requested historical snapshot unavailable in this fixture'};
   let entities=fixture.hideEntities?[]:[...fixture.entities.values()];
   const wantedKey=/\$key = key\((0x[0-9a-fA-F]+)\)/.exec(query)?.[1];if(wantedKey)entities=entities.filter(entity=>entity.key===wantedKey);
   const creator=/\$creator = addr\((0x[0-9a-fA-F]+)\)/.exec(query)?.[1];if(creator)entities=entities.filter(entity=>entity.creator.toLowerCase()===creator.toLowerCase());
   for(const match of query.matchAll(/(?:^| AND )(\w+) = str\('([^']*)'\)/g))entities=entities.filter(entity=>entity.attributes.some(attribute=>attribute.name===match[1]&&attribute.value===match[2]));
   if(fixture.missingAfterTransfer&&fixture.sends.some(send=>send.operationTags.includes(4)))entities=[];
   const start=options.cursor?Number(options.cursor.split(':')[1]):0;
   const count=Math.min(2,options.limit?Number(BigInt(options.limit)):2);
   const selected=entities.slice(start,start+count).map(entity=>Object.fromEntries(Object.entries(entity).filter(([name])=>options.select[name])));
   return{blockNumber:hex(fixture.head),data:selected,...(entities.length>start+count?{cursor:'offline:'+String(start+count)}:{})};
  }
  if(method==='eth_sendTransaction'||method==='eth_sendRawTransaction'){
   if(fixture.denyMutation)throw{code:-32000,message:'Mutation not permitted'};
   if(fixture.beforeSend)await fixture.beforeSend({method,params:arguments_});
   const tx=method==='eth_sendRawTransaction'?{...parseTransaction(arguments_[0]),from:await recoverTransactionAddress({serializedTransaction:arguments_[0]})}:arguments_[0], actor=tx.from.toLowerCase();
   const operations=decodeFunctionData({abi:execute,data:tx.data}).args[0];
   if(fixture.staleNonce){fixture.nonces.set(actor,(fixture.nonces.get(actor)??0n)+1n);fixture.staleNonce=false;}
   const txHash=method==='eth_sendRawTransaction'?keccak256(arguments_[0]):'0x'+(++globalTx).toString(16).padStart(64,'0');const logs=[];const decodedOps=[];
   for(const operation of operations){const value=decodeAbiParameters(params[operation.operation],operation.operationData)[0];decodedOps.push({operation:operation.operation,value});
    if(operation.operation===1){
     const mint=fixture.nonces.get(actor)??0n;const key=predictEntityKey({owner:tx.from,nonce:mint,salt:value.salt,chainId:tiramisu.id});fixture.nonces.set(actor,mint+1n);
     const cells=value.attributes.map(decodeAttribute);const expiresAt=BigInt(value.expiresAt)>fixture.head+value.minLifetime?BigInt(value.expiresAt):fixture.head+value.minLifetime;
     const entity={key,owner:tx.from,creator:tx.from,createdAt:hex(fixture.head),updatedAt:hex(fixture.head),expiresAt:hex(expiresAt),creationFlags:value.creationFlags,contentType:cells.find(cell=>cell.name==='$contentType').value,payload:cells.find(cell=>cell.name==='$payload').value,attributes:cells.filter(cell=>!cell.name.startsWith('$'))};
     fixture.entities.set(key,entity);
     logs.push({address:'0x4400000000000000000000000000000000000044',topics:encodeEventTopics({abi:ENTITY_EVENTS_ABI,eventName:'EntityCreated',args:{entityKey:key,owner:tx.from}}),data:encodeAbiParameters(parseAbiParameters('uint64,uint8'),[expiresAt,value.creationFlags])});
    }else{
     const entity=fixture.entities.get(value.entityKey);if(!entity)throw new Error('Fixture entity not found');
     if(operation.operation===2){for(const cell of value.mutations){const name=text(cell.name);if(name==='$payload')entity.payload=cell.value;else if(name==='$contentType')entity.contentType=text(cell.value);else{entity.attributes=entity.attributes.filter(attribute=>attribute.name!==name);if(cell.typeId!==0)entity.attributes.push(decodeAttribute(cell));}}entity.updatedAt=hex(fixture.head);}
     if(operation.operation===3){entity.expiresAt=hex(BigInt(value.expiresAt)>fixture.head+value.minLifetime?value.expiresAt:fixture.head+value.minLifetime);logs.push({address:'0x4400000000000000000000000000000000000044',topics:encodeEventTopics({abi:ENTITY_EVENTS_ABI,eventName:'ExpiryExtended',args:{entityKey:value.entityKey,owner:entity.owner}}),data:encodeAbiParameters(parseAbiParameters('uint64'),[BigInt(entity.expiresAt)])});}
     if(operation.operation===4)entity.owner=value.newOwner;
     if(operation.operation===5)fixture.entities.delete(value.entityKey);
    }
   }
   fixture.sends.push({txHash,operationTags:operations.map(operation=>operation.operation),decodedOps});
   fixture.transactions.set(txHash,{hash:txHash,from:tx.from,to:tx.to,input:tx.data,value:hex(tx.value??0),nonce:hex(tx.nonce??fixture.sends.length-1),gas:hex(tx.gas??100000),chainId:hex(tx.chainId??tiramisu.id),gasPrice:hex(tx.gasPrice??tx.maxFeePerGas??1),...(tx.maxFeePerGas===undefined?{}:{maxFeePerGas:hex(tx.maxFeePerGas),maxPriorityFeePerGas:hex(tx.maxPriorityFeePerGas)}),blockHash:'0x'+'aa'.repeat(32),blockNumber:hex(fixture.head),transactionIndex:'0x0',type:tx.type==='eip1559'?'0x2':'0x0',v:hex(tx.v??27),r:tx.r??'0x'+'00'.repeat(32),s:tx.s??'0x'+'00'.repeat(32)});
   fixture.receipts.set(txHash,{status:'0x1',transactionHash:txHash,blockHash:'0x'+'aa'.repeat(32),blockNumber:hex(fixture.head),transactionIndex:'0x0',gasUsed:'0x1',cumulativeGasUsed:'0x1',effectiveGasPrice:'0x1',from:tx.from,to:'0x4400000000000000000000000000000000000044',contractAddress:null,logs:(fixture.omitCreateLogs?[]:logs).map((log,index)=>({...log,blockNumber:hex(fixture.head),blockHash:'0x'+'aa'.repeat(32),transactionHash:txHash,transactionIndex:'0x0',logIndex:hex(index),removed:false})),logsBloom:'0x'+'00'.repeat(256),type:'0x0'});
   if(fixture.broadcastResponseLost)throw new Error('Synthetic response lost after acceptance');
   return txHash;
  }
  throw new Error('Unexpected offline fixture RPC method '+method);
 }
 fixture.request=request;
 fixture.reader=createPublicClient({chain:tiramisu,transport:custom({request},{retryCount:0}),cacheTime:0});
 fixture.wallet=createWalletClient({chain:tiramisu,account:owner,transport:custom({request},{retryCount:0}),cacheTime:0});
 fixture.fetch=async(_url,input)=>{const body=JSON.parse(input.body);const respond=async body=>{try{return{jsonrpc:'2.0',id:body.id,result:await request(body)};}catch(error){return{jsonrpc:'2.0',id:body.id,error:{code:error.code??-32000,message:error.message}};}};return Response.json(Array.isArray(body)?await Promise.all(body.map(respond)):await respond(body));};
 return fixture;
}
