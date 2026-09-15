// Test-only site boundary fixture; no production switch can disable network verification.
const realFetch=globalThis.fetch;
globalThis.fetch=(url,init)=>String(url)==='https://forum.example.com/about.json'
 ? Promise.resolve(new Response(JSON.stringify({about:{title:'Fixture forum'}}),{status:200,headers:{'content-type':'application/json'}}))
 : realFetch(url,init);
