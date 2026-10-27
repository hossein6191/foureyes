# FourEyes

A payment that two people must work out independently: each checker seals a
step-by-step working before either can see the other's, the network reads the
two side by side, and the money moves in that same call on whether they match.

## The problem

Many payments are a calculation. A shop owes a refund under its returns
policy; an agency owes a commission under a contract; a partner is owed a
share. The careful way to pay one is the four-eyes rule: two people work it
out, and the money goes only when they agree. In practice the second person
reads the first person's figures and nods, and a check that was copied is no
check at all. Nobody can see whether the second working was done or
transcribed, and whoever compares the two decides what "agree" means.

FourEyes makes the two workings independent by construction, and makes the
comparison something neither the payer, the payee nor the checkers control.

## What it is

A requester locks a payout for a beneficiary, plus a fee for each of two
checkers it names, in one call. Each checker works the task out alone and
writes the working down as 2 to 12 numbered steps whose last step states the
result.

1. **Commit.** Each checker posts `sha256(working + "|" + salt)`, 64 hex
   characters, once, inside the commit window. The other checker's digest is
   refused, so a copied commitment cannot stand in for a working.
2. **Reveal.** Only once both have committed, or the commit window has closed,
   does either reveal: the working exactly as sealed (a JSON array of steps)
   and its salt of 16 to 64 letters and digits. The digest is checked first,
   then the shape. Neither checker can see the other's working before its own
   is sealed.
3. **Compare.** Once both workings are revealed, anybody may ask the network
   to read them side by side, and the money moves in the same call:

| finding | what happens in the same transaction |
|---|---|
| `agree` | the payout goes to the beneficiary and each checker is paid its fee |
| `diverged` at step k | both fees are paid (the work was done), the payout is held, and step k is recorded where everyone can read it next to both workings |
| `unclear` | nothing moves; the same two sealed workings may be read once more after 300 seconds; a second `unclear` is settled as `diverged` is |

A held payout is the requester's to decide: release it to the beneficiary or
take it back. A requester who leaves it undecided for three days lets anyone
default it to a refund. A task whose commits or reveals are missing when the
windows close is expired by anyone, and so is a task whose two revealed
workings no reading has settled three days after the reveal deadline.

## How consensus is used

One `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` block in `compare()`,
with four sequential askings inside its leader closure: two questions, each in
both presentation orders.

> **SAME.** Do WORKING A and WORKING B reach the same final result for the
> TASK? Answer yes, no or unclear.

followed in the prompt by what each answer means: "yes means their final
results are the same; no means their final results are different; unclear
means you cannot tell."

> **FIRST.** Reading both workings step by step in order, what is the number of
> the first step at which WORKING B states a different figure, rule or
> conclusion from WORKING A's step with the same number? Answer that number, or
> NONE if no step differs.

followed by: "A number means that step is the first where the two workings
part; a step one working has and the other lacks counts as different. NONE
means every step states the same figure, rule or conclusion as the other
working's step with the same number."

Each question asks one plain thing. Each is asked twice: once with checker A's
working shown as WORKING A, and once with the two workings swapped under the
labels, each keeping its own step numbers.

| asking | WORKING A | WORKING B | question |
|---|---|---|---|
| `same/a_then_b` | checker A's | checker B's | SAME |
| `same/b_then_a` | checker B's | checker A's | SAME |
| `first/a_then_b` | checker A's | checker B's | FIRST |
| `first/b_then_a` | checker B's | checker A's | FIRST |

The first step where two workings part is the same whichever is called A, so
an honest reader names the same number in both orders. A reader led by the
label, or by where a step sits on the page, does not.

**Reading the answers strictly.** A SAME answer counts as `yes`, `no` or
`unclear` (in any case; `true`/`false` and a JSON boolean read as yes/no,
`unsure` as unclear). A FIRST answer counts only as a step number from 1 to the
longer working's step count, written as an int or as one or two ASCII digits
with no leading zero, or the word `NONE`. Anything else (`"step 2"`, `"2."`,
`"2 or 3"`, a boolean, a fraction, a step neither working has) is unreadable,
and the combine rule reads an unreadable answer as unclear. A JSON fraction is
refused by the parser hook before it is built.

| the four readings | stored |
|---|---|
| SAME `yes` in both orders, FIRST `NONE` in both orders | `{"finding": "agree", "step": "0"}` |
| SAME `no` in both orders, FIRST the same step k in both orders | `{"finding": "diverged", "step": "k"}` |
| anything else, an unreadable answer included | `{"finding": "unclear", "step": "0"}` |

The two questions check each other. A reader that says the results differ must
also find the step where the workings part, and one that says they are the
same must find no step that differs. When they do not line up, the disagreement
is stored as `unclear`, never smoothed into a guess.

**Agreement.** Every validator reruns all four askings itself and compares the
finding and the step with the leader's by exact string equality. There is no
tolerance anywhere. A validator whose own rerun raises disagrees, and a leader
that raised is never agreed with, so an unreachable model is never stored as
an answer. The leader's four readings come back in the result, keyed by asking
(`{"same/a_then_b": "no", "same/b_then_a": "no", "first/a_then_b": "2",
"first/b_then_a": "2"}`), so a run shows why it landed where it did; they are
never compared or stored, and are returned only when they are well formed and
combine to the agreed value.

**The prompt boundary.** The task and every step reach the model fenced (`<`
and `>` replaced, never deleted) between delimiter lines tagged with the
sha256 of the block's own fenced text, after a paragraph that declares all
three blocks untrusted and says what a block claims about itself counts for
nothing. The door admits only printable ASCII on one line, so no look-alike
bracket can draw a delimiter the fence does not know. The steps are numbered
by the contract. The model never sees an amount, an address, a digest or a
salt. The largest possible prompt, a 1,500-character task and two workings of
1,800 characters each, is under 8,000 characters, and nothing judged is ever
cut.

## Why this has to be on GenLayer

Whether two workings written in different words reach the same result, and
where they part, is a judgement about meaning. "240 at 70 percent is 168" and
"70% of 240 is 168" are the same step; "Day 18 is within the refund period, so
the full 100 percent is refunded" is the step where one working leaves the
policy's 70 percent band. No string comparison tells those apart. A single
model call is one reading its caller controls. Here every validator reads for
itself, both questions in both orders, and only a value they agree on moves
money, in the same transaction that reads it.

## Who may do what

| call | who | refused how |
|---|---|---|
| `open_task(beneficiary, task_text, checker_a, checker_b, payout_atto, fee_atto, commit_seconds, reveal_seconds)` | anyone; the sender is the requester | returns `ok: false` with every atto sent: four parties that are not four different addresses, the contract as a party, a task outside 40 to 1,500 ASCII characters, a payout outside 0.1 to 100 GEN, a fee outside 0.01 to 5 GEN, a window outside 600 seconds to 7 days, a value that is not exactly the payout and both fees, no clock |
| `commit(task_id, digest)` | the two checkers the task names, once each, inside the commit window | raises `[EXPECTED] ...`; nothing was sent |
| `reveal(task_id, working, salt)` | the two checkers, once each, after committing; only once both have committed or the commit window has closed, and before the reveal deadline | raises `[EXPECTED] ...`, and may be sent again before the deadline |
| `compare(task_id)` | anyone, once both workings are revealed; an unclear task once more, 300 seconds after it | raises `[EXPECTED] ...` before any model is asked |
| `decide(task_id, release)` | only the requester, while the payout is held | raises `[EXPECTED] ...` |
| `default_refund(task_id)` | anyone, three days after the hold, while it is still undecided | raises `[EXPECTED] ...` |
| `expire(task_id)` | anyone, once the windows have run out on a missing commitment or working, or three days after the reveal deadline on two revealed workings no reading has settled | raises `[EXPECTED] ...` |

The one payable call, `open_task`, asks no model and never raises after taking
value: every refusal returns everything that was sent. `compare` runs the
round and takes no value, so a round that stores nothing strands nothing; it
is simply asked again.

## The money

| moment | from | to | amount |
|---|---|---|---|
| `open_task` | the requester | the contract, held by the task | the payout and both fees, exactly |
| `open_task`, refused | the contract | the requester | everything sent |
| `compare`, `agree` | the task | the beneficiary, and each checker | the payout, and one fee each |
| `compare`, `diverged`, or `unclear` the second time | the task | each checker | one fee each; the payout stays held |
| `compare`, `unclear` the first time | | | nothing moves |
| `decide(true)` | the held payout | the beneficiary | the payout |
| `decide(false)` | the held payout | the requester | the payout |
| `default_refund`, after three days undecided | the held payout | the requester | the payout |
| `expire` | the task | the requester, and each checker that revealed | the payout and the fee of each checker that did not reveal; one fee to each checker that did |

Every call moves money only after everything it writes is written, and makes
at most three transfers. The contract holds exactly what its open tasks still
hold, and `stats()` publishes it as `balance_owed`. The offline suite checks
it against the contract's books after every step of forty seeded random
journeys, and drains every journey to zero.

### Every settlement is bounded

- Each task is settled in its own calls. No call reads another task, walks the
  tasks or walks an address's list.
- Every loop runs over at most 12 steps of one working, or one page of 20
  rows. `tasks` and `tasks_of` page at 20.
- There is no cap on tasks, per address or in all, so no stranger can fill a
  door and shut it on anybody else. Only a task's own windows, its own status
  and its own parties close it.

## Who uses it

- **A shop paying refunds under a policy**, where two bookkeepers must each
  work out the refund before it leaves.
- **An agency or marketplace paying commissions**, where the sales record and
  the contract terms are read by two people who never see each other's sums.
- **A partnership or a shared treasury** settling a share, a grant or a
  reimbursement that the rules say needs two signatures, and wants the two
  signatures to mean two pieces of work.

## The limits, stated plainly

- **Two colluding checkers can agree on a wrong result.** The contract buys
  two independent workings, not the truth. If both checkers make the same
  mistake, or agree in private, the network will find them in agreement and
  the payout will go.
- **The network checks that the two workings match each other, not that they
  are right.** It is never asked whether either working applies the policy
  correctly, nor whether the task is fair.
- **The model never sees the payout.** It never checks that the result the
  checkers reached is the amount the requester locked; the requester names the
  amount.
- **The requester names both checkers.** A checker on the requester's side can
  always send the payout back: by diverging, or by committing and never
  revealing, which costs it only its fee, and that fee goes to the requester.
  The beneficiary is protected only as far as the checkers are independent of
  the requester.
- **A held payout is the requester's to decide.** The beneficiary is paid on
  `agree`, or when the requester releases a held payout; never otherwise.
- **The same result by other steps is not `agree`.** FIRST compares step by
  step, so two workings that reach one figure by different routes read
  `unclear`, and a second `unclear` holds the payout for the requester.
- **An unclear task is read once more, then held.** One extra reading, after
  300 seconds, and no more.
- **A round the network never agrees on stores nothing.** Three days after the
  reveal deadline anyone may expire such a task: both fees are paid and the
  payout goes back to the requester.
- **Everything is public once posted.** Digests at once, workings when
  revealed, the finding and the step when read.
- **A checker who seals a working the door refuses can never reveal it.** A
  working is 2 to 12 steps of 3 to 300 characters, at most 1,800 characters
  together; one sealed in another shape loses its checker's fee to the
  requester when the task expires.
- **English, in printable ASCII on one line.** The door refuses anything else.
- **No readable clock, no commit, reveal, compare, decision, default or
  expiry.** The clock is the message clock, `gl.message_raw["datetime"]`, the
  same on every node.

## What is in this repository

```
contracts/foureyes.py         the contract
tests/test_pure.py            the offline suite: the rules, the round with a scripted model per node, every journey
tests/MUTATIONS.md            every defence removed in turn, and the test that caught it
tests/on_chain/smoke.mjs      a throwaway-account run against Studio
tools/mutate.py               the generator that writes MUTATIONS.md and refuses to if anything survives
CONTRACTS.md                  purpose, consensus, state, methods, bounds, reuse and limits
DECISIONS.md                  why each rule is the way it is, and what is verified and what is not
```

## Running it

```
pip install -r requirements-dev.txt
pytest tests/ -q                               # no network, no Studio
genvm-lint check contracts/foureyes.py         # the package is genvm-linter, the command genvm-lint
python tools/mutate.py                         # rewrites tests/MUTATIONS.md; exits 1 if a mutant survives
```

- `pytest tests/ -q` gives **395 passed** in a few seconds, with nothing
  installed but pytest.
- `genvm-lint check` version 0.11.0 prints `Lint passed (3 checks)` and
  `Validation passed`, reads FourEyes as 12 methods (5 view, 7 write), and
  exits 0.
- `python tools/mutate.py` removes or inverts **280 defences** one at a time,
  and **none survives**; `tests/MUTATIONS.md` names the test that failed for
  each.

The on-chain run generates its own keys and funds them over the network's own
RPC; it never touches a wallet of anybody's own:

```
npm ci
node tests/on_chain/smoke.mjs                  # the whole run, about 25 to 40 minutes
RESUME=1 node tests/on_chain/smoke.mjs         # continue a run that was cut off
STATE=run.json RESUME=1 node tests/on_chain/smoke.mjs
```

It plays five generated accounts. Kestrel Outdoor, the requester, deploys the
contract, is refused an `open_task` sent one atto short with every atto
returned, and opens three refunds under one policy (100% within 14 days, 70%
from day 15 to day 30, less a 15-unit restocking fee after day 14). On T1, a
240-unit tent returned on day 20, both bookkeepers reach 153 units in
different words; a stranger's commit is refused, a reveal with the wrong salt
is refused, and the comparison reads `agree`: 1.53 GEN reaches the customer and
0.05 GEN each bookkeeper in that transaction. On T2, a rucksack returned on day
18, the second bookkeeper refunds in full at step 2 and reaches 225; the
comparison reads `diverged` at step 2, both fees are paid, the customer is
refused when it tries to release the payout, and the shop releases it. On T3,
a headlamp returned on day 5, only the first bookkeeper ever commits; the
stranger is refused an early expiry, the bookkeeper reveals once the
ten-minute commit window closes, and the stranger expires T3: the payout and
the missing bookkeeper's fee go back to the shop, the bookkeeper who did the
work is paid. The run prints one PASS or FAIL line per check, reads every
account's balance against the receipts, and compares the deployed code with
`contracts/foureyes.py` byte for byte. Every step is saved to the state file as
it is made, so a run that outlives its process continues where it stopped
without sending anything twice.

## Network

Studio, chain 61999. RPC `https://studio.genlayer.com/api`, explorer
`https://explorer-studio.genlayer.com`. The contract pins the runner
`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` in its first
line.

## Evidence

The on-chain run is recorded here once it has run.

## Licence

MIT. See `LICENSE`.
