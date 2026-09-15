#!/usr/bin/env node
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const args=process.argv.slice(2),path=process.env.WB_FAKE_HOST;
if(args[0]==='--version'){console.log('fixture');process.exit(0);}
let state=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{};
if(args[1]==='list')console.log(JSON.stringify(Object.keys(state).map(name=>({name}))));
else if(args[1]==='get'){if(process.env.WB_FAIL_READBACK && state[args[2]]?.transport?.url && !existsSync(process.env.WB_FAIL_READBACK)){writeFileSync(process.env.WB_FAIL_READBACK,'failed');process.exit(1);}console.log(JSON.stringify(state[args[2]]));}
else if(args[1]==='add'){
 const sep=args.indexOf('--');
 state[args[2]]=sep>=0?{transport:{type:'stdio',command:args[sep+1],args:args.slice(sep+2)}}:{transport:{type:'http',url:args[args.indexOf('--url')+1]}};
 writeFileSync(path,JSON.stringify(state));
}else if(args[1]==='remove'){delete state[args[2]];writeFileSync(path,JSON.stringify(state));}
else process.exit(2);
