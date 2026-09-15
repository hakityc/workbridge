#!/usr/bin/env node
// Compatibility command. Protocol negotiation, pagination and timeouts belong to the official SDK.
import { probe } from './dist/probe.js';
import { connectors } from './dist/connectors.js';
const argv=process.argv.slice(2), separator=argv.indexOf('--');
const allowed=new Set(connectors().map(c=>c.probe.tool));
let required=[], read;
try {
  if(separator<0 || !argv[separator+1])throw Error('needs -- command');
  for(let i=0;i<separator;i+=2){
    const flag=argv[i],value=argv[i+1];
    if(!value || value.startsWith('--'))throw Error(`${flag} needs one read-only tool name`);
    if(flag==='--require')required=value.split(',');
    else if(flag==='--probe'){if(!allowed.has(value))throw Error('only accepts read-only tools');read=connectors().find(c=>c.probe.tool===value).probe;}
    else throw Error('unknown option');
  }
  const result=await probe({command:argv[separator+1],args:argv.slice(separator+2),env:process.env,required,probe:read,timeout:Number(process.env.FLOW_MCP_PROBE_TIMEOUT_MS)||15000});
  console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;
}catch(e){console.log(JSON.stringify({ok:false,stage:'arguments',error:e.message}));process.exitCode=1;}
