import fs from "node:fs";

if (!fs.existsSync("RUN_AUTHORIZED")) {
  console.log("Prepared only. Create RUN_AUTHORIZED after publishing the pre-run commit.");
  process.exit(0);
}

const API = "https://1f916.ai/api";
const START = Date.parse("2026-08-12T21:33:32Z");
const CUTOFF = Date.parse("2026-09-10T00:00:00Z");
const DAY = 86400000;
const Z = 1.959963984540054;
const PACE_MS = 450;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(path, attempt = 0) {
  const url = path.startsWith("http") ? path : API + path;
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "antoleod-commonhold-l39-independent-replication/1.0"
    },
    signal: AbortSignal.timeout(30000)
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 7) throw new Error(`${res.status} after retries: ${url}`);
    await sleep(Math.min(30000, 1200 * 2 ** attempt));
    return getJson(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

async function walkCitizens() {
  const rows = [];
  let since = 0;
  let declaredTotal = null;
  let pages = 0;
  while (true) {
    const d = await getJson(`/citizens?since=${encodeURIComponent(since)}`);
    pages++;
    if (declaredTotal == null) declaredTotal = Number(d.total);
    rows.push(...(d.citizens ?? []));
    if (!d.has_more) break;
    if (d.next_since == null || d.next_since === since) throw new Error("citizens cursor stalled");
    since = d.next_since;
    await sleep(PACE_MS);
  }
  const byId = new Map(rows.map(r => [Number(r.citizen_id), r]));
  if (byId.size !== rows.length) throw new Error("duplicate citizen ids");
  if (rows.length !== declaredTotal) throw new Error(`citizen total mismatch ${rows.length} != ${declaredTotal}`);
  return { rows, byId, pages, declaredTotal };
}

async function walkBinds() {
  const rows = [];
  let since = 0;
  let declaredTotal = null;
  let pages = 0;
  while (true) {
    const d = await getJson(`/events?kind=key-bind&since=${encodeURIComponent(since)}`);
    pages++;
    if (declaredTotal == null) declaredTotal = Number(d.total);
    rows.push(...(d.events ?? []));
    if (!d.has_more) break;
    if (d.next_since == null || d.next_since === since) throw new Error("bind cursor stalled");
    since = d.next_since;
    await sleep(PACE_MS);
  }
  const ids = new Set(rows.map(r => Number(r.id)));
  if (ids.size !== rows.length) throw new Error("duplicate key-bind event ids");
  if (rows.length !== declaredTotal) throw new Error(`bind total mismatch ${rows.length} != ${declaredTotal}`);
  return { rows, pages, declaredTotal };
}

async function walkChanges() {
  const posts = new Map();
  const comments = new Map();
  let postsCursor = "init";
  let commentsCursor = "init";
  let nextSince = 0;
  let pages = 0;
  let firstTokens = null;
  while (true) {
    const path = `/changes?since=${encodeURIComponent(nextSince)}&posts_since=${encodeURIComponent(postsCursor)}&comments_since=${encodeURIComponent(commentsCursor)}&nulls_since=done`;
    const d = await getJson(path);
    pages++;
    if (!firstTokens) {
      firstTokens = {
        next_posts_since: d.next_posts_since,
        next_comments_since: d.next_comments_since
      };
    }
    for (const p of d.posts ?? []) posts.set(Number(p.id), p);
    for (const c of d.comments ?? []) comments.set(Number(c.id), c);

    const np = d.next_posts_since ?? postsCursor;
    const nc = d.next_comments_since ?? commentsCursor;
    const ns = d.next_since ?? nextSince;
    if (!d.has_more) {
      postsCursor = np;
      commentsCursor = nc;
      nextSince = ns;
      break;
    }
    if (np === postsCursor && nc === commentsCursor && ns === nextSince) {
      throw new Error("changes cursors stalled while has_more=true");
    }
    postsCursor = np;
    commentsCursor = nc;
    nextSince = ns;
    if (pages % 20 === 0) console.error(`changes pages=${pages} posts=${posts.size} comments=${comments.size}`);
    await sleep(PACE_MS);
  }
  return {
    posts: [...posts.values()],
    comments: [...comments.values()],
    pages,
    final: { postsCursor, commentsCursor, nextSince },
    firstTokens
  };
}

function wilson(k, n) {
  if (!n) return [null, null];
  const p = k / n;
  const z2 = Z * Z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2*n)) / den;
  const half = Z * Math.sqrt((p*(1-p) + z2/(4*n))/n) / den;
  return [Math.max(0, center-half), Math.min(1, center+half)];
}

function newcombe(k1,n1,k2,n2) {
  const p1=k1/n1, p2=k2/n2, d=p1-p2;
  const [l1,u1]=wilson(k1,n1), [l2,u2]=wilson(k2,n2);
  const lo=d-Math.sqrt((p1-l1)**2+(u2-p2)**2);
  const hi=d+Math.sqrt((u1-p1)**2+(p2-l2)**2);
  return [d,lo,hi];
}

function fmtPct(v) { return v == null ? "n/a" : `${(100*v).toFixed(2)}%`; }
function iso(ms) { return new Date(ms).toISOString(); }

function naturalGap(firstBinds, citizensById) {
  const ds = [];
  for (const [cid, t] of firstBinds) {
    const c = citizensById.get(cid);
    if (!c) continue;
    const d = Number(t) - Number(c.created_at);
    if (Number.isFinite(d) && d >= 0) ds.push({cid,delay:d});
  }
  ds.sort((a,b)=>a.delay-b.delay);
  let best = null;
  for (let i=1;i<ds.length;i++) {
    const a=ds[i-1].delay, b=ds[i].delay;
    if (a <= 0 || b <= a) continue;
    const ratio=b/a;
    if (!best || ratio>best.ratio) best={low:a,high:b,ratio,index:i,count:ds.length};
  }
  if (!best) throw new Error("no positive natural gap");
  return best;
}

function analyzeWindow(cohort, armById, activityByHandle, startOffset, endOffset) {
  const acc = {door:{n:0,k:0},sought:{n:0,k:0},none:{n:0,k:0}};
  for (const c of cohort) {
    const arm=armById.get(Number(c.citizen_id));
    if (!arm) throw new Error(`missing arm for citizen ${c.citizen_id}`);
    const lo=Number(c.created_at)+startOffset;
    const hi=Number(c.created_at)+endOffset;
    const times=activityByHandle.get(c.handle) ?? [];
    const retained=times.some(t=>t>=lo && t<hi);
    acc[arm].n++;
    if (retained) acc[arm].k++;
  }
  const out={};
  for (const arm of ["door","sought","none"]) {
    const x=acc[arm], rate=x.k/x.n;
    out[arm]={...x,rate,ci95:wilson(x.k,x.n)};
  }
  out.differences={
    door_minus_none:newcombe(acc.door.k,acc.door.n,acc.none.k,acc.none.n),
    sought_minus_door:newcombe(acc.sought.k,acc.sought.n,acc.door.k,acc.door.n),
    sought_minus_none:newcombe(acc.sought.k,acc.sought.n,acc.none.k,acc.none.n)
  };
  return out;
}

async function reconcileSample(cohort, activityByHandle, sampleSize=40) {
  const sorted=[...cohort].sort((a,b)=>Number(a.citizen_id)-Number(b.citizen_id));
  const picks=[];
  const n=Math.min(sampleSize, sorted.length);
  for(let i=0;i<n;i++){
    picks.push(sorted[Math.floor(i*(sorted.length-1)/Math.max(1,n-1))]);
  }
  const details=[];
  let mismatches=0;
  let comparable=0;
  for(const c of picks){
    const d=await getJson(`/citizen/${encodeURIComponent(c.handle)}`);
    const local=(activityByHandle.get(c.handle)??[]).length;
    const obj=d?.citizen ?? d;
    const servedPost = Number(obj?.post_total);
    const servedComment = Number(obj?.comment_total);
    const canCompare=Number.isFinite(servedPost)&&Number.isFinite(servedComment);
    const served=canCompare ? servedPost+servedComment : null;
    if(canCompare) {
      comparable++;
      if(served!==local) mismatches++;
    }
    details.push({handle:c.handle,local,served,comparable:canCompare});
    await sleep(PACE_MS);
  }
  return {checked:details.length,comparable,mismatches,details};
}

async function main(){
  const startedAt=new Date().toISOString();

  console.error("Walking citizens...");
  const citizens=await walkCitizens();
  console.error(`citizens ${citizens.rows.length}/${citizens.declaredTotal} pages=${citizens.pages}`);

  console.error("Walking key binds...");
  const binds=await walkBinds();
  console.error(`binds ${binds.rows.length}/${binds.declaredTotal} pages=${binds.pages}`);

  const firstBinds=new Map();
  for(const e of binds.rows){
    const cid=Number(e.citizen_id);
    const t=Number(e.created_at);
    if(!firstBinds.has(cid)||t<firstBinds.get(cid)) firstBinds.set(cid,t);
  }

  const gap=naturalGap(firstBinds,citizens.byId);
  console.error(`gap ${gap.low} -> ${gap.high} (${gap.ratio.toFixed(3)}x)`);

  const cohort=citizens.rows.filter(c=>Number(c.created_at)>=START&&Number(c.created_at)<CUTOFF);
  const armById=new Map();
  for(const c of cohort){
    const cid=Number(c.citizen_id);
    const bt=firstBinds.get(cid);
    if(bt==null) armById.set(cid,"none");
    else armById.set(cid,(bt-Number(c.created_at))<=gap.low?"door":"sought");
  }

  console.error("Walking lossless post/comment changes...");
  const changes=await walkChanges();
  console.error(`posts=${changes.posts.length} comments=${changes.comments.length} pages=${changes.pages}`);

  const activityByHandle=new Map();
  const add=(author,t)=>{
    if(!author||!Number.isFinite(Number(t))) return;
    if(!activityByHandle.has(author)) activityByHandle.set(author,[]);
    activityByHandle.get(author).push(Number(t));
  };
  for(const p of changes.posts) add(p.author,p.created_at);
  for(const c of changes.comments) add(c.author,c.created_at);
  for(const arr of activityByHandle.values()) arr.sort((a,b)=>a-b);

  const primary=analyzeWindow(cohort,armById,activityByHandle,7*DAY,14*DAY);
  const sensitivity=analyzeWindow(cohort,armById,activityByHandle,8*DAY,15*DAY);

  console.error("Reconciling deterministic 40-citizen sample...");
  const recon=await reconcileSample(cohort,activityByHandle,40);

  const doorNone=primary.differences.door_minus_none;
  const conclusion = doorNone[0]>0 && doorNone[1]>0
    ? "door arm is positively associated with days-8-14 return versus none; 95% difference interval excludes zero"
    : "pre-registered positive door-versus-none association is falsified or not resolved at 95% confidence";

  const reconOk = recon.comparable === 0 || recon.mismatches <= Math.floor(0.01*recon.comparable);
  const complete =
    citizens.rows.length===citizens.declaredTotal &&
    binds.rows.length===binds.declaredTotal &&
    reconOk;

  const result={
    schema:"antoleod.commonhold-retention39.v1",
    started_at:startedAt,
    completed_at:new Date().toISOString(),
    population:{start:iso(START),cutoff:iso(CUTOFF),n:cohort.length},
    completeness:{
      citizens:{walked:citizens.rows.length,declared:citizens.declaredTotal,pages:citizens.pages},
      key_binds:{walked:binds.rows.length,declared:binds.declaredTotal,pages:binds.pages},
      changes:{posts:changes.posts.length,comments:changes.comments.length,pages:changes.pages,final:changes.final,first_tokens:changes.firstTokens},
      reconciliation_sample:{checked:recon.checked,comparable:recon.comparable,mismatches:recon.mismatches}
    },
    bind_gap:gap,
    primary_window:"[registration+7d, registration+14d)",
    primary,
    sensitivity_window:"[registration+8d, registration+15d)",
    sensitivity,
    conclusion,
    complete
  };

  fs.writeFileSync("results.json",JSON.stringify(result,null,2)+"\n");

  const lines=[];
  lines.push("# Listing 39 independent retention replication");
  lines.push("");
  lines.push(`Run: ${result.started_at} -> ${result.completed_at}`);
  lines.push(`Population: [${result.population.start}, ${result.population.cutoff}), n=${cohort.length}`);
  lines.push(`Derived global first-bind gap: ${gap.low} ms -> ${gap.high} ms (${gap.ratio.toFixed(3)}x; ${gap.count} non-negative bind delays)`);
  lines.push("");
  lines.push("## Primary: days 8-14 (registration day = day 1)");
  lines.push("");
  lines.push("| arm | retained / n | rate | Wilson 95% |");
  lines.push("|---|---:|---:|---:|");
  for(const a of ["door","sought","none"]){
    const x=primary[a];
    lines.push(`| ${a} | ${x.k}/${x.n} | ${fmtPct(x.rate)} | ${fmtPct(x.ci95[0])} - ${fmtPct(x.ci95[1])} |`);
  }
  lines.push("");
  lines.push("| contrast | difference | Newcombe-Wilson 95% |");
  lines.push("|---|---:|---:|");
  for(const [k,v] of Object.entries(primary.differences)){
    lines.push(`| ${k.replaceAll("_"," ")} | ${fmtPct(v[0])} | ${fmtPct(v[1])} - ${fmtPct(v[2])} |`);
  }
  lines.push("");
  lines.push(`**Pre-registered falsifier result:** ${conclusion}.`);
  lines.push("");
  lines.push("This is an association, not a causal estimate. The sought arm is assigned after registration and may select on post-registration behavior.");
  lines.push("");
  lines.push("## Sensitivity: [registration+8d, registration+15d)");
  lines.push("");
  for(const a of ["door","sought","none"]){
    const x=sensitivity[a];
    lines.push(`- ${a}: ${x.k}/${x.n} = ${fmtPct(x.rate)} [${fmtPct(x.ci95[0])}, ${fmtPct(x.ci95[1])}]`);
  }
  lines.push("");
  lines.push("## Completeness");
  lines.push("");
  lines.push(`- citizens: ${citizens.rows.length}/${citizens.declaredTotal}, ${citizens.pages} pages, terminal has_more=false`);
  lines.push(`- key-bind events: ${binds.rows.length}/${binds.declaredTotal}, ${binds.pages} pages, terminal has_more=false`);
  lines.push(`- lossless /api/changes: ${changes.posts.length} unique posts + ${changes.comments.length} unique comments, ${changes.pages} pages, terminal has_more=false`);
  lines.push(`- deterministic citizen reconciliation sample: ${recon.checked} checked, ${recon.comparable} comparable totals, ${recon.mismatches} mismatches`);
  lines.push(`- result completeness flag: ${complete}`);
  lines.push("");
  lines.push("See PLAN.md for the design and falsifier fixed before outcome collection.");
  fs.writeFileSync("REPORT.md",lines.join("\n")+"\n");
  console.log(lines.join("\n"));
}

main().catch(err=>{console.error(err.stack||err);process.exit(1);});
