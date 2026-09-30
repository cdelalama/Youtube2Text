// Read-only, bounded Plaud v1 snapshot. Redirect stdout to private custody outside Git.
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const hash=x=>createHash('sha256').update(x).digest('hex');
const output=process.env.OUTPUT_DIR||'/data/output';
if(!process.env.Y2T_API_KEY) throw Error('missing_api_key');
const api='http://127.0.0.1:'+(process.env.PORT||8787);const headers={'x-api-key':process.env.Y2T_API_KEY};
async function get(path){const r=await fetch(api+path,{headers,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('read_http_'+r.status);return r;}
const listing=await (await get('/v1/transcripts?limit=500')).json();
if(listing.items.length>=500 || listing.page?.hasMore)throw Error('bounded_inventory_exceeded');
async function count(dir){let n=0;for(const e of await readdir(dir,{withFileTypes:true})){if(e.isDirectory())n+=await count(join(dir,e.name));else if(/^trn_[a-f0-9]+\.json$/.test(e.name))n++;}return n;}
if(await count(join(output,'_transcripts/v1'))!==listing.items.length)throw Error('inventory_incomplete');
const db=new DatabaseSync(join(output,'_jobs/media2text.sqlite'),{readOnly:true});db.exec('BEGIN');
const items=[];
try{for(const item of listing.items){
 const response=await get('/v1/transcripts/'+encodeURIComponent(item.transcriptId));
 const recordBytes=await response.text();if(hash(recordBytes)!==item.recordSha256||response.headers.get('x-media2text-record-sha256')!==item.recordSha256)throw Error('record_integrity');
 const r=JSON.parse(recordBytes);if(r.schemaVersion!=='media2text.transcript.v1'||r.source.kind!=='intake')throw Error('unsupported_scope');
 const row=db.prepare('SELECT request_json FROM intakes WHERE intake_id=?').get(r.correlation.intakeId);if(!row)throw Error('missing_admission');const a=JSON.parse(row.request_json);
 const md=r.representations.find(x=>x.format==='markdown');const path=resolve(output,md.relativePath);if(relative(output,path).startsWith('..'))throw Error('outside_output');
 const markdownBytes=await readFile(path,'utf8');if(hash(markdownBytes)!==md.sha256||Buffer.byteLength(markdownBytes)!==md.bytes)throw Error('markdown_integrity');
 items.push({recordBytes,recordSha256:item.recordSha256,markdownBytes,admission:{authority:a.source.authority,sourceItemId:a.source.itemId,sourceCollectionId:a.source.collectionId??null,artifactRevision:'sha256:'+a.artifact.sha256}});
 }
}finally{db.exec('ROLLBACK');db.close();}
console.log(JSON.stringify({schemaVersion:'media2text.markdown-input.v1',complete:true,observedAt:new Date().toISOString(),collectionMethod:'authenticated immutable GET and read-only SQLite admission identity',items}));
