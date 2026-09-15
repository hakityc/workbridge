#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
const args=process.argv.slice(2);
if(args.includes('--version')){console.log('fixture');process.exit(0);}
if(args.includes('generate-user-api-key')){
 if(process.env.WB_CANCEL_BROWSER==='1')process.exit(1);
 const target=args[args.indexOf('--save-to')+1],site=args[args.indexOf('--site')+1];
 writeFileSync(target,JSON.stringify({auth_pairs:[{site,user_api_key:'fixture-discourse-key'}]}),{mode:0o600});console.log('fixture browser authorization completed');process.exit(0);
}
const input=createInterface({input:process.stdin});
input.on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 let result;
 if(m.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fake-discourse',version:'1'}};
 else if(m.method==='tools/list')result={tools:['discourse_search','discourse_read_post',...(args.includes('--allow_writes')?['discourse_create_post']:[])].map(name=>({name,inputSchema:{type:'object'}}))};
 else result=process.env.WB_EXPIRED_DISCOURSE==='1'?{isError:true,content:[{type:'text',text:'401 invalid token fixture-discourse-key'}]}:{content:[{type:'text',text:'{"results":[],"meta":{"has_more":false}}'}]};
 console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
});
