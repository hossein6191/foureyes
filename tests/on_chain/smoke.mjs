/* FourEyes against GenLayer Studio (chain 61999), with throwaway accounts. Deploys its own copy.
 *
 *   npm ci                                                  # genlayer-js 1.1.8 and viem 2.56.8
 *   node tests/on_chain/smoke.mjs                           # the whole run, from a fresh state
 *   RESUME=1 node tests/on_chain/smoke.mjs                  # continue a run that was cut off
 *   STATE=/some/dir/run.json RESUME=1 node tests/on_chain/smoke.mjs   # the same, with the state kept elsewhere
 *
 * Five generated accounts play the story: REQUESTER is Kestrel Outdoor, the shop that owes refunds and
 * deploys the contract; BENEFICIARY is the customer the refunds are owed to; CHECKER_A and CHECKER_B are two
 * bookkeepers who each work a refund out alone; STRANGER is somebody with no part in any task.
 *
 *   1  deploy FourEyes. REQUESTER sends an open_task one atto short and is refused with every atto returned,
 *      then opens T1 (a 240-unit tent returned on day 20), T2 (a 240-unit rucksack returned on day 18) and
 *      T3 (a 90-unit headlamp returned on day 5), each locking its payout and both checkers' fees. T3's commit
 *      window is the shortest the contract allows, ten minutes. CHECKER_A commits to T3 at once.
 *   2  T1. STRANGER tries to commit and is refused. Both checkers commit sha256(working + "|" + salt), and
 *      CHECKER_B's first reveal, with the wrong salt, is refused; then both reveal. Both workings reach 153
 *      units (240 at 70 percent is 168, less the 15-unit restocking fee) in slightly different words.
 *      BENEFICIARY asks for the comparison: one consensus block, four askings (both questions, each with
 *      the workings in both orders), reads agree, and in the same transaction 1.53 GEN reaches BENEFICIARY
 *      and 0.05 GEN reaches each checker.
 *   3  T2. Both commit and reveal; CHECKER_B forgets the 70 percent band, refunds in full at step 2 and
 *      reaches 225. STRANGER asks for the comparison: it reads diverged at step 2, both fees are paid in the
 *      same transaction and the payout is held. BENEFICIARY tries to release it and is refused: only the
 *      requester decides. REQUESTER reads both workings and releases the payout to BENEFICIARY.
 *   4  T3. STRANGER tries to expire it while its commit window is open and is refused. Once the window has
 *      closed on the chain's own clock, with CHECKER_B never having committed, CHECKER_A reveals, and
 *      STRANGER expires T3: the payout and CHECKER_B's unearned fee go back to REQUESTER, and CHECKER_A,
 *      who did the work, is paid its fee.
 *   5  the views read back, the deployed code compared with the file byte for byte, the contract's balance
 *      read, and every account's net movement checked against the receipts.
 *
 * Every refusal is a signed transaction. Balances are read after finalisation, because a transfer lands at
 * FINALIZED, not at ACCEPTED. Transactions are polled with eth_getTransactionByHash, never with views. A
 * comparison no majority carried stores nothing, and since compare takes no value it strands nothing
 * either: the call is sent again and both transactions are kept. A comparison read unclear is read once
 * more after the cooldown, waited out by the chain's own clock. Every step is saved as it is made, so a run
 * cut off part way continues without sending anything twice. Every id (T1 to T3, the contract address) is
 * read from a receipt; a step whose receipt does not carry the id it needs stops the run rather than guess.
 * A whole run takes about 25 to 40 minutes: one deployment and 23 transactions, two of them consensus
 * rounds of four askings each, and at most a few minutes' wait for T3's ten-minute commit window.
 *
 * A state file remembers the sha256 of the contract it deployed, and a RESUME against a state made from
 * another file stops before sending anything.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
import { getAddress } from "viem";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC = "https://studio.genlayer.com/api";
const STATE = process.env.STATE || join(tmpdir(), "foureyes-smoke-state.json");
const RECORD = process.env.RECORD || STATE.replace(/\.json$/, "") + "-record.json";
const FILE = new URL("../../contracts/foureyes.py", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const rpc = async (m, p) => {
  let last;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      const j = await r.json();
      if (j.error && (j.error.code === -32029 || r.status === 429)) { await sleep(((j.error.data?.retry_after_seconds) || 20) * 1000); continue; }
      if (j.error) { last = new Error(m + ": " + JSON.stringify(j.error).slice(0, 200)); await sleep(6000); continue; }
      return j.result;
    } catch (e) { last = e; await sleep(4000); }
  }
  throw last;
};
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  - " + d : ""}`); return !!c; };
const GEN = 10n ** 18n;
const tally = (v) => `${v.agree} agree, ${v.disagree} disagree, ${v.idle} idle`;
const sha = (b) => createHash("sha256").update(b).digest("hex");

// ---------- state: keys, addresses, salts and every step already made survive a cut-off run ----------
const st = existsSync(STATE) && process.env.RESUME ? JSON.parse(readFileSync(STATE, "utf8")) : {};
st.keys = st.keys || {}; st.steps = st.steps || {}; st.views = st.views || {}; st.order = st.order || []; st.ids = st.ids || {};
st.salts = st.salts || {};
const SOURCE_SHA = sha(readFileSync(FILE));
if (st.source_sha256 && st.source_sha256 !== SOURCE_SHA) {
  console.log(`the state file ${STATE} belongs to a run of another contract file; start a fresh run without RESUME, or name another STATE`);
  process.exit(2);
}
st.source_sha256 = SOURCE_SHA;
const save = () => {
  writeFileSync(STATE, JSON.stringify(st, null, 1));
  const { keys, ...shown } = st;       // the record carries no key
  writeFileSync(RECORD, JSON.stringify(shown, null, 1));
};
const ROLES = {
  requester: "Kestrel Outdoor, the shop that owes the refunds, locks each payout and deploys the contract",
  beneficiary: "the customer each refund is owed to",
  checker_a: "the first bookkeeper, who works every refund out alone",
  checker_b: "the second bookkeeper, who works T1 and T2 out alone and never commits to T3",
  stranger: "somebody with no part in any task, who compares and expires",
};
for (const k of Object.keys(ROLES)) st.keys[k] = st.keys[k] || generatePrivateKey();
const acct = {}, client = {};
for (const k of Object.keys(ROLES)) { acct[k] = createAccount(st.keys[k]); client[k] = createClient({ chain: studionet, account: acct[k] }); }
const rd = createClient({ chain: studionet });
st.accounts = Object.fromEntries(Object.keys(ROLES).map((k) => [k, getAddress(acct[k].address)]));
const low = (a) => String(a).toLowerCase();
for (const k of ["checker_a", "checker_b"]) for (const t of ["T1", "T2", "T3"]) st.salts[k + t] = st.salts[k + t] || randomBytes(16).toString("hex");
save();

// an id the run needs, read from a receipt; without it the run stops rather than guess
const need = (value, what) => {
  if (value === undefined || value === null || value === "") {
    ok(`the receipt carries ${what}`, false, "stopping: nothing after this step can be sent without it");
    st.checks = { pass, fail }; save();
    process.exit(1);
  }
  return value;
};

const balance = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]) || "0x0");
const nonceOf = async (a) => Number(BigInt(await rpc("eth_getTransactionCount", [a, "latest"]) || "0x0"));
const fundOnce = async (k, whole) => {
  st.funded = st.funded || {};
  if (st.funded[k]) return;
  await rpc("sim_fundAccount", { account_address: getAddress(acct[k].address), amount: whole * 1e18 });   // checksummed; amount in atto, as a number
  for (let i = 0; i < 20 && (await balance(acct[k].address)) === 0n; i++) await sleep(3000);
  st.funded[k] = String(await balance(acct[k].address)); save();
};

// ---------- transactions ----------
const errText = (e) => String(e?.details || e?.shortMessage || e?.cause?.message || e?.message || e);
// A request the network refused or never received is made again. When the failure is ambiguous the
// sender's nonce says whether the transaction landed after all, and its hash is read back, so nothing
// is ever sent twice.
const sendRaw = async (who, what, make) => {
  const addr = acct[who].address;
  for (let i = 0; ; i++) {
    const n0 = await nonceOf(addr);
    try { return await make(); } catch (e) {
      if (i >= 8) throw e;
      console.log(`      ${what} was not taken (${errText(e).slice(0, 70)}); looking again in 20s`);
      await sleep(20000);
      if ((await nonceOf(addr)) > n0) {
        const list = await rpc("sim_getTransactionsForAddress", [addr]);
        const hit = (list || []).find((t) => low(t.from_address) === low(addr) && Number(t.nonce) === n0);
        if (hit?.hash) return hit.hash;
        throw new Error(what + " landed but its hash could not be read back");
      }
    }
  }
};
const countVotes = (t) => { let a = 0, d = 0, idl = 0; for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else idl++; } return { agree: a, disagree: d, idle: idl }; };
const wait = async (tx) => {
  let stuck = 0;
  for (let i = 0; i < 900; i++) {
    await sleep(4000);
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "FINALIZED") {
      const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = "";
      try { msg = Buffer.from(one.result, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      const v = countVotes(t);
      return { tx, msg, exec: one?.execution_result || "", votes: v, applied: v.agree * 2 > v.agree + v.disagree + v.idle, address: t.data?.contract_address || t.to_address || "" };
    }
    // a round no majority carried is final as it stands once it has been left alone for ten minutes
    if (t?.status === "UNDETERMINED" && (stuck = stuck + 1) > 150) return { tx, msg: "UNDETERMINED", exec: "", votes: countVotes(t), applied: false, address: "" };
    if (t?.status === "CANCELED") return { tx, msg: "CANCELED", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
    if (i > 0 && i % 75 === 0) console.log(`      [${stamp()}] still ${t?.status || "unknown"} after ${Math.round(i * 4 / 60)} minutes: ${tx}`);
  }
  return { tx, msg: "TIMEOUT", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
};
const jsonOf = (msg) => { const b = String(msg).indexOf("{"); if (b === -1) return null; try { return JSON.parse(String(msg).slice(b)); } catch (e) { return null; } };
const settleBalance = async (a, before, want) => { for (let i = 0; i < 45; i++) { const b = await balance(a); if (b - before === want) return b; await sleep(4000); } return await balance(a); };

// One step: a signed transaction, its tally, what it returned, and the balances it moved. begin() sends it
// (once), end() waits for it; call() is both. opt.watch names the roles whose balances are read before and
// after, opt.expect the change each should show (a table, or a function of what the call returned), and
// opt.again how long to wait before sending it again when the contract answered "not yet".
const begin = async (id, who, fn, args = [], opt = {}) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, fn, args: args.map((x) => String(x).slice(0, 80)), value: String(opt.value || 0n), tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (rec.done || rec.pending) return;
  if (!rec.before) { rec.before = {}; for (const k of opt.watch || []) rec.before[k] = String(await balance(acct[k].address)); save(); }
  rec.pending = await sendRaw(who, fn, () => client[who].writeContract({ address: need(st.foureyes, "the contract's address"), functionName: fn, args, ...(opt.value ? { value: opt.value } : {}) }));
  save();
};
const end = async (id, who, fn, args = [], opt = {}) => {
  const rec = st.steps[id];
  if (!rec.done) {
    for (;;) {
      if (!rec.pending) await begin(id, who, fn, args, opt);
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg });
      rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} ${fn}(${args.map((x) => String(x).slice(0, 22)).join(", ")})${opt.value ? " +" + Number(opt.value) / 1e18 + " GEN" : ""}  ${r.tx}  ${tally(r.votes)}  ${r.exec}`);
      if (r.msg === "TIMEOUT" || rec.tries.length >= 4) break;
      if (!r.applied) { console.log("      the validators did not carry that round (" + tally(r.votes) + "), so nothing was stored; sending it again"); continue; }
      const again = opt.again ? opt.again(r) : 0;
      if (again > 0) { console.log(`      not yet; waiting ${Math.round(again / 1000)} s and sending it again`); await sleep(again); continue; }
      break;
    }
    const last = rec.tries[rec.tries.length - 1];
    const expect = typeof opt.expect === "function" ? opt.expect(jsonOf(last.msg)) : opt.expect;
    rec.after = {}; rec.delta = {};
    for (const k of opt.watch || []) {
      const before = BigInt(rec.before[k]);
      const want = expect && expect[k] !== undefined ? BigInt(expect[k]) : null;
      const now = want === null ? await balance(acct[k].address) : await settleBalance(acct[k].address, before, want);
      rec.after[k] = String(now); rec.delta[k] = String(now - before);
    }
    rec.done = true; save();
  }
  const last = rec.tries[rec.tries.length - 1];
  return { ...last, j: jsonOf(last.msg), tries: rec.tries, delta: rec.delta || {} };
};
const call = async (id, who, fn, args = [], opt = {}) => { await begin(id, who, fn, args, opt); return end(id, who, fn, args, opt); };
const refused = (r, words) => r.exec === "ERROR" && r.msg.includes(words);
const moved = (r, k, want) => r.delta[k] === String(want);
const votes = (r) => r.tries.map((t) => tally(t.votes)).join(", then ");
const notYet = (r) => { const m = /open for another (\d+) seconds/.exec(r.msg); return r.exec === "ERROR" && m ? (Number(m[1]) + 15) * 1000 : 0; };

const deploy = async (id, who) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, fn: "deploy contracts/foureyes.py", args: [], value: "0", tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    const code = readFileSync(FILE, "utf8");
    for (;;) {
      if (!rec.pending) { rec.pending = await sendRaw(who, "deploy", () => client[who].deployContract({ code, args: [], leaderOnly: false })); save(); }
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg.slice(0, 300) });
      rec.address = r.address; rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} deploy foureyes  ${r.tx}  ${tally(r.votes)}  ${r.exec}  ${r.address}`);
      if (r.applied || r.msg === "TIMEOUT" || rec.tries.length >= 3) break;
    }
    rec.done = true; save();
  }
  return need(rec.address, "the address of the deployed contract");
};

// ---------- reads: paced, and made again on a 429 instead of failing ----------
let lastRead = 0;
const read = async (fn, args = []) => {
  for (let i = 0; i < 30; i++) {
    const gap = 3500 - (Date.now() - lastRead);
    if (gap > 0) await sleep(gap);
    lastRead = Date.now();
    try { return JSON.parse(String(await rd.readContract({ address: st.foureyes, functionName: fn, args }))); } catch (e) {
      if (i === 29) return { error: "VIEW ERROR " + fn + ": " + errText(e).slice(0, 100) };
      await sleep(/rate|429|limit/i.test(errText(e)) ? 25000 : 10000);
    }
  }
};
// a view read once for a check is kept with the run, so a continued run checks what was seen then
const seen = async (id, fn, args = []) => { if (!st.views[id]) { st.views[id] = { fn, args, at: stamp(), out: await read(fn, args) }; save(); } return st.views[id].out; };
// wait, by the chain's own clock, until one of a task's instants has passed: the view reports the message
// clock as `now` (or -1 when a read carries none, and then this machine's clock stands in)
const untilPast = async (tid, field) => {
  const row = await read("task", [tid]);
  const now = Number(row.now > 0 ? row.now : Math.floor(Date.now() / 1000));
  const left = Number(row[field] || 0) - now;
  if (left > -10) { console.log(`      [${stamp()}] waiting ${left + 20} s, by the chain clock, for ${field} of ${tid} to pass`); await sleep((left + 20) * 1000); }
};

// ---------- the demonstration ----------
const PAYOUT = 153n * GEN / 100n, PAYOUT3 = 90n * GEN / 100n, FEE = 5n * GEN / 100n;
const VALUE = PAYOUT + 2n * FEE, VALUE3 = PAYOUT3 + 2n * FEE;
// The suite reads these out of this file and checks they are the texts it judges.
const TASK1 = "A customer of Kestrel Outdoor returned a 240-unit tent 20 days after buying it; the policy refunds 100% within 14 days, 70% from day 15 to day 30, minus a 15-unit restocking fee after day 14. How much is refunded?";
const TASK2 = "A customer of Kestrel Outdoor returned a 240-unit rucksack 18 days after buying it; the policy refunds 100% within 14 days, 70% from day 15 to day 30, minus a 15-unit restocking fee after day 14. How much is refunded?";
const TASK3 = "A customer of Kestrel Outdoor returned a 90-unit headlamp 5 days after buying it; the policy refunds 100% within 14 days, 70% from day 15 to day 30, minus a 15-unit restocking fee after day 14. How much is refunded?";
const A1 = ["The tent cost 240 units and was returned 20 days after it was bought.", "Day 20 falls in the band from day 15 to day 30, so the refund rate is 70%.", "70% of 240 is 168.", "The return is after day 14, so the 15-unit restocking fee applies: 168 - 15 = 153. The refund is 153 units."];
const B1 = ["Price 240 units; returned on day 20 after purchase.", "Day 20 is inside the day 15 to day 30 band, which refunds 70 percent.", "240 at 70 percent is 168.", "After day 14 a 15-unit restocking fee is taken: 168 - 15 = 153. Refund: 153 units."];
const A2 = ["The rucksack cost 240 units and was returned 18 days after it was bought.", "Day 18 falls in the band from day 15 to day 30, so the refund rate is 70%.", "70% of 240 is 168.", "The return is after day 14, so the 15-unit restocking fee applies: 168 - 15 = 153. The refund is 153 units."];
const B2 = ["Price 240 units; returned on day 18 after purchase.", "Day 18 is within the refund period, so the full 100 percent is refunded.", "240 at 100 percent is 240.", "After day 14 a 15-unit restocking fee is taken: 240 - 15 = 225. Refund: 225 units."];
const A3 = ["The headlamp cost 90 units and was returned 5 days after it was bought.", "Day 5 is within 14 days, so the refund rate is 100% and no restocking fee applies.", "100% of 90 is 90. The refund is 90 units."];
// a working is sealed exactly as it will be revealed: the JSON text of its steps, a |, and the salt
const working = (steps) => JSON.stringify(steps);
const seal = (steps, salt) => sha(JSON.stringify(steps) + "|" + salt);
const ASKED_AS = ["same/a_then_b", "same/b_then_a", "first/a_then_b", "first/b_then_a"];
const readingsOf = (j) => ASKED_AS.map((k) => (j?.readings || {})[k] || "-").join(",");
const pays = (j) => ({ beneficiary: BigInt(j?.to_beneficiary || 0), checker_a: BigInt(j?.to_checker_a || 0), checker_b: BigInt(j?.to_checker_b || 0) });

await fundOnce("requester", 8); await fundOnce("beneficiary", 1); await fundOnce("checker_a", 1); await fundOnce("checker_b", 1); await fundOnce("stranger", 1);
if (!st.start) { st.start = {}; for (const k of Object.keys(ROLES)) st.start[k] = String(await balance(acct[k].address)); st.started = new Date().toISOString(); save(); }
console.log(`[${stamp()}] ${Object.keys(ROLES).map((k) => k.toUpperCase().padEnd(12) + st.accounts[k] + "  " + ROLES[k]).join("\n           ")}\n           state ${STATE}`);
const [R, B, CA, CB] = ["requester", "beneficiary", "checker_a", "checker_b"].map((k) => st.accounts[k]);

// ================================================================ 1
console.log(`\n[${stamp()}] ---- 1: deploy FourEyes and open three tasks`);
st.foureyes = st.foureyes || await deploy("deploy", "requester");
save();
console.log(`      FourEyes at ${st.foureyes}`);
{
  const short = await call("openShort", "requester", "open_task", [B, TASK1, CA, CB, String(PAYOUT), String(FEE), 3600, 3600], { value: VALUE - 1n, watch: ["requester"], expect: { requester: 0n } });
  ok("REQUESTER sends open_task one atto short: refused, and every atto it sent comes back in the same transaction", short.j?.ok === false && String(short.j?.reason).includes("send exactly the payout and both fees") && short.j?.returned === String(VALUE - 1n) && moved(short, "requester", 0n), `${votes(short)}  ${short.msg.slice(0, 120)}`);
  for (const [n, text, payout, commit, reveal] of [["T1", TASK1, PAYOUT, 3600, 3600], ["T2", TASK2, PAYOUT, 3600, 3600], ["T3", TASK3, PAYOUT3, 600, 86400]]) {
    const value = payout + 2n * FEE;
    const o = await call("open" + n, "requester", "open_task", [B, text, CA, CB, String(payout), String(FEE), commit, reveal], { value, watch: ["requester"], expect: { requester: -value } });
    st.ids[n] = need(o.j?.task, "the id of " + n); save();
    ok(`REQUESTER opens ${st.ids[n]}, locking ${Number(payout) / 1e18} GEN for BENEFICIARY and 0.05 GEN for each checker; commit window ${commit} s`, o.j?.ok === true && o.j?.held === String(value) && moved(o, "requester", -value), `${votes(o)}  ${o.msg.slice(0, 110)}`);
  }
  const c3 = await call("commitT3A", "checker_a", "commit", [st.ids.T3, seal(A3, st.salts.checker_aT3)]);
  ok(`CHECKER_A commits to ${st.ids.T3}; CHECKER_B never will`, c3.j?.ok === true && c3.j?.both_committed === false, `${votes(c3)}  ${c3.msg.slice(0, 100)}`);
}

// ================================================================ 2
console.log(`\n[${stamp()}] ---- 2: ${st.ids.T1}, two workings that agree`);
{
  const t = st.ids.T1;
  const s = await call("strangerCommitsT1", "stranger", "commit", [t, seal(A1, "x".repeat(16))], { watch: ["stranger"], expect: { stranger: 0n } });
  ok(`STRANGER tries to commit to ${t} and is refused: only the two checkers the task names may`, refused(s, "only the two checkers of " + t + " may commit to it") && moved(s, "stranger", 0n), `${votes(s)}  ${s.msg.slice(0, 110)}`);
  const ca = await call("commitT1A", "checker_a", "commit", [t, seal(A1, st.salts.checker_aT1)]);
  const cb = await call("commitT1B", "checker_b", "commit", [t, seal(B1, st.salts.checker_bT1)]);
  ok(`both checkers seal their workings for ${t}; neither working is on chain yet`, ca.j?.ok === true && cb.j?.ok === true && cb.j?.both_committed === true, `${votes(ca)} | ${votes(cb)}`);
  const wrong = await call("revealT1BWrongSalt", "checker_b", "reveal", [t, working(B1), st.salts.checker_aT1]);
  ok(`CHECKER_B reveals its working with the wrong salt and is refused: it does not match the digest it committed`, refused(wrong, "do not match the digest checker B committed to " + t), `${votes(wrong)}  ${wrong.msg.slice(0, 120)}`);
  const ra = await call("revealT1A", "checker_a", "reveal", [t, working(A1), st.salts.checker_aT1]);
  const rb = await call("revealT1B", "checker_b", "reveal", [t, working(B1), st.salts.checker_bT1]);
  ok(`both reveal, and ${t} is ready to compare`, ra.j?.ok === true && rb.j?.ok === true && rb.j?.status === "revealed" && rb.j?.steps === 4, `${votes(ra)} | ${votes(rb)}  ${rb.msg.slice(0, 80)}`);
  let cmp = await call("compareT1", "beneficiary", "compare", [t], { watch: ["beneficiary", "checker_a", "checker_b"], expect: (j) => pays(j) });
  if (cmp.j?.finding === "unclear") {
    console.log(`      ${t} read unclear (${readingsOf(cmp.j)}); it is read once more after the cooldown`);
    if (!st.steps.compareT1again?.done) await untilPast(t, "reread_at");
    cmp = await call("compareT1again", "beneficiary", "compare", [t], { watch: ["beneficiary", "checker_a", "checker_b"], expect: (j) => pays(j), again: notYet });
  }
  ok(`BENEFICIARY asks for ${t} to be compared: the four askings read agree`, cmp.j?.finding === "agree" && cmp.j?.step === 0 && cmp.j?.status === "paid", `${votes(cmp)}  ${cmp.j?.finding ?? cmp.msg.slice(0, 80)}  readings ${readingsOf(cmp.j)}`);
  ok("and in the same transaction 1.53 GEN reaches BENEFICIARY and 0.05 GEN each checker", moved(cmp, "beneficiary", PAYOUT) && moved(cmp, "checker_a", FEE) && moved(cmp, "checker_b", FEE), JSON.stringify(cmp.delta));
}

// ================================================================ 3
console.log(`\n[${stamp()}] ---- 3: ${st.ids.T2}, two workings that part at step 2`);
{
  const t = st.ids.T2;
  const ca = await call("commitT2A", "checker_a", "commit", [t, seal(A2, st.salts.checker_aT2)]);
  const cb = await call("commitT2B", "checker_b", "commit", [t, seal(B2, st.salts.checker_bT2)]);
  const ra = await call("revealT2A", "checker_a", "reveal", [t, working(A2), st.salts.checker_aT2]);
  const rb = await call("revealT2B", "checker_b", "reveal", [t, working(B2), st.salts.checker_bT2]);
  ok(`both checkers seal and reveal ${t}; CHECKER_B refunds in full at step 2 and reaches 225`, ca.j?.ok && cb.j?.ok && ra.j?.ok && rb.j?.status === "revealed", `${votes(ca)} | ${votes(cb)} | ${votes(ra)} | ${votes(rb)}`);
  let cmp = await call("compareT2", "stranger", "compare", [t], { watch: ["beneficiary", "checker_a", "checker_b"], expect: (j) => pays(j) });
  if (cmp.j?.finding === "unclear" && cmp.j?.status === "unclear") {
    console.log(`      ${t} read unclear (${readingsOf(cmp.j)}); it is read once more after the cooldown`);
    if (!st.steps.compareT2again?.done) await untilPast(t, "reread_at");
    cmp = await call("compareT2again", "stranger", "compare", [t], { watch: ["beneficiary", "checker_a", "checker_b"], expect: (j) => pays(j), again: notYet });
  }
  ok(`STRANGER asks for ${t} to be compared: the four askings read diverged at step 2`, cmp.j?.finding === "diverged" && cmp.j?.step === 2 && cmp.j?.status === "held", `${votes(cmp)}  ${cmp.j?.finding ?? cmp.msg.slice(0, 80)} at ${cmp.j?.step}  readings ${readingsOf(cmp.j)}`);
  ok("and in the same transaction each checker is paid 0.05 GEN while the 1.53 GEN payout is held", moved(cmp, "checker_a", FEE) && moved(cmp, "checker_b", FEE) && moved(cmp, "beneficiary", 0n) && cmp.j?.held === String(PAYOUT), JSON.stringify(cmp.delta));
  const bd = await call("beneficiaryDecidesT2", "beneficiary", "decide", [t, true], { watch: ["beneficiary"], expect: { beneficiary: 0n } });
  ok(`BENEFICIARY tries to release the held payout of ${t} and is refused: only the requester decides`, refused(bd, "only the requester of " + t + " decides") && moved(bd, "beneficiary", 0n), `${votes(bd)}  ${bd.msg.slice(0, 110)}`);
  const row = await seen("T2held", "task", [t]);
  ok(`task(${t}) shows both workings and where they part: step 2, 70 percent against 100 percent`, row.status === "held" && row.step === 2 && row.working_a?.[1] === A2[1] && row.working_b?.[1] === B2[1] && row.paid?.checker_a === String(FEE), JSON.stringify({ status: row.status, step: row.step, decide_by: row.decide_by }));
  const rd2 = await call("requesterReleasesT2", "requester", "decide", [t, true], { watch: ["beneficiary", "requester"], expect: { beneficiary: PAYOUT, requester: 0n } });
  ok(`REQUESTER reads both workings and releases ${t}'s 1.53 GEN to BENEFICIARY`, rd2.j?.ok === true && rd2.j?.status === "released" && moved(rd2, "beneficiary", PAYOUT), `${votes(rd2)}  ${JSON.stringify(rd2.delta)}`);
}

// ================================================================ 4
console.log(`\n[${stamp()}] ---- 4: ${st.ids.T3}, a checker who never committed`);
{
  const t = st.ids.T3;
  const early = await call("earlyExpireT3", "stranger", "expire", [t], { watch: ["requester"], expect: { requester: 0n } });
  ok(`STRANGER tries to expire ${t} early and is refused: its commit window is still open, or CHECKER_A may still reveal`, early.exec === "ERROR" && (early.msg.includes("is open for another") || early.msg.includes("may still reveal")) && moved(early, "requester", 0n), `${votes(early)}  ${early.msg.slice(0, 120)}`);
  if (!st.steps.revealT3A?.done) await untilPast(t, "commit_deadline");
  const r3 = await call("revealT3A", "checker_a", "reveal", [t, working(A3), st.salts.checker_aT3], { again: notYet });
  ok(`once the commit window has closed by the chain's clock, CHECKER_A reveals ${t} alone`, r3.j?.ok === true && r3.j?.status === "open" && r3.j?.steps === 3, `${votes(r3)}  ${r3.msg.slice(0, 100)}`);
  const ex = await call("expireT3", "stranger", "expire", [t], { watch: ["requester", "checker_a", "checker_b"], expect: { requester: PAYOUT3 + FEE, checker_a: FEE, checker_b: 0n }, again: notYet });
  ok(`STRANGER expires ${t}: the 0.9 GEN payout and CHECKER_B's unearned fee go back to REQUESTER, and CHECKER_A is paid its fee`, ex.j?.ok === true && ex.j?.committed === 1 && ex.j?.revealed === 1 && moved(ex, "requester", PAYOUT3 + FEE) && moved(ex, "checker_a", FEE) && moved(ex, "checker_b", 0n), `${votes(ex)}  ${JSON.stringify(ex.delta)}`);
}

// ================================================================ 5
console.log(`\n[${stamp()}] ---- 5: the views, the code, and the money`);
{
  const t1 = await seen("T1", "task", [st.ids.T1]);
  ok(`task(${st.ids.T1}): paid, agree, both workings as revealed, nothing held`, t1.status === "paid" && t1.finding === "agree" && JSON.stringify(t1.working_a) === JSON.stringify(A1) && JSON.stringify(t1.working_b) === JSON.stringify(B1) && t1.held === "0" && t1.paid?.beneficiary === String(PAYOUT), JSON.stringify({ status: t1.status, finding: t1.finding, readings: t1.readings }));
  const t2 = await seen("T2", "task", [st.ids.T2]);
  ok(`task(${st.ids.T2}): released after diverging at step 2, nothing held`, t2.status === "released" && t2.finding === "diverged" && t2.step === 2 && t2.held === "0", JSON.stringify({ status: t2.status, finding: t2.finding, step: t2.step }));
  const t3 = await seen("T3", "task", [st.ids.T3]);
  ok(`task(${st.ids.T3}): expired, CHECKER_A's working shown and CHECKER_B's empty`, t3.status === "expired" && t3.committed === 1 && JSON.stringify(t3.working_a) === JSON.stringify(A3) && t3.working_b?.length === 0 && t3.paid?.checker_a === String(FEE), JSON.stringify({ status: t3.status, paid: t3.paid }));
  const page = await seen("tasks", "tasks", [0, 20]);
  ok("tasks(0, 20): three tasks, a page of at most 20", page.total === 3 && page.limit === 20 && page.rows?.length === 3, JSON.stringify(page.rows?.map((x) => [x.task, x.status, x.finding, x.step])));
  const mine = await seen("tasksOfA", "tasks_of", [CA, 0, 20]);
  ok("tasks_of(CHECKER_A, 0, 20): checker A on all three", mine.total === 3 && mine.rows?.every((x) => x.role === "checker_a"), JSON.stringify(mine.rows?.map((x) => [x.task, x.role])));
  const stats = await seen("stats", "stats", []);
  ok("stats(): three tasks, two readings, one agreed, one diverged and released, one expired, one refusal, nothing owed", stats.tasks === 3 && stats.readings >= 2 && stats.agreed === 1 && stats.diverged === 1 && stats.released === 1 && stats.expired === 1 && stats.refused === 1 && stats.balance_owed === "0", JSON.stringify(stats));
  const rules = await seen("rules", "rules", []);
  ok("rules(): both questions word for word, the combine rule, the money and the limits", String(rules.questions?.same).startsWith("Do WORKING A and WORKING B reach the same final result") && String(rules.questions?.first).startsWith("Reading both workings step by step in order") && rules.sizes?.steps?.[1] === 12 && rules.sizes?.page === 20 && String(rules.compared).includes("exact string equality") && rules.limits?.length === 4, Object.keys(rules).join(","));
  const held = await balance(st.foureyes);
  ok("the FourEyes contract holds exactly what it owes: nothing", held === 0n && stats.balance_owed === String(held), String(held));

  const file = readFileSync(FILE);
  const chain = Buffer.from(String(await rpc("gen_getContractCode", [st.foureyes])), "base64");
  st.code = { address: st.foureyes, bytes: chain.length, sha256: sha(chain), file_bytes: file.length, file_sha256: sha(file), identical: Buffer.compare(chain, file) === 0 };
  save();
  ok(`the code deployed at ${st.foureyes} is byte for byte contracts/foureyes.py`, st.code.identical, `${chain.length} bytes, sha256 ${st.code.sha256}`);

  st.end = {}; for (const k of Object.keys(ROLES)) st.end[k] = String(await balance(acct[k].address));
  st.ended = new Date().toISOString(); save();
  // what each account should have gained or lost, read off the receipts: an opened task takes its value from
  // the requester and a refused one returns it; a comparison pays the beneficiary and the checkers what it
  // says; a decision pays the beneficiary or the requester; an expiry pays the requester and the checkers
  const want = { requester: 0n, beneficiary: 0n, checker_a: 0n, checker_b: 0n, stranger: 0n };
  for (const id of st.order) {
    const s = st.steps[id], j = jsonOf(s.tries.at(-1)?.msg || "");
    if (!j || j.ok !== true) continue;
    if (s.fn === "open_task") want.requester -= BigInt(j.held);
    if (s.fn === "compare") { want.beneficiary += BigInt(j.to_beneficiary); want.checker_a += BigInt(j.to_checker_a); want.checker_b += BigInt(j.to_checker_b); }
    if (s.fn === "decide") { want.beneficiary += BigInt(j.to_beneficiary); want.requester += BigInt(j.to_requester); }
    if (s.fn === "expire") { want.requester += BigInt(j.to_requester); want.checker_a += BigInt(j.to_checker_a); want.checker_b += BigInt(j.to_checker_b); }
  }
  const net = (k) => BigInt(st.end[k]) - BigInt(st.start[k]);
  ok("over the run every account ends exactly where the receipts say", Object.keys(want).every((k) => net(k) === want[k]), Object.keys(want).map((k) => k.toUpperCase() + " " + Number(net(k)) / 1e18 + " (receipts " + Number(want[k]) / 1e18 + ")").join("  "));
}

st.checks = { pass, fail }; save();
console.log(`\n${pass} passed, ${fail} failed`);
console.log("FourEyes:", st.foureyes);
console.log("transactions:", st.order.reduce((n, id) => n + st.steps[id].tries.length, 0), "in", st.order.length, "steps; sent a second time:", st.order.filter((id) => st.steps[id].tries.length > 1).join(", ") || "none");
for (const id of st.order) { const s = st.steps[id], j = jsonOf(s.tries.at(-1)?.msg || ""); if (s.fn === "compare" && j?.finding) console.log(`${id.padEnd(16)} ${s.tries.map((t) => t.tx + " " + tally(t.votes)).join(" | ")}  ${j.finding} at ${j.step}  readings ${readingsOf(j)}`); }
console.log("record:", RECORD);
process.exit(fail ? 1 : 0);
