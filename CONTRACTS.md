# Contracts

One file. `contracts/foureyes.py`, class `FourEyes`, is the contract.

## FourEyes

### Purpose

A payment that two people must work out independently before it is made. A
requester locks a payout for a beneficiary and a fee for each of two checkers.
Each checker seals a numbered, step-by-step working of the task with a salted
hash, and reveals it only once both are sealed or the commit window has
closed, so neither can see the other's working before committing to its own.
The network then reads the two workings side by side and decides whether they
reach the same result and, if not, at which step they part. The money moves in
the call that reads them: the payout to the beneficiary on agreement; both
fees, with the payout held for the requester, on divergence. Every task is
settled in its own calls, and every loop is bounded by a constant, so no
settlement grows with the number of tasks.

### Consensus

One round, `_compare_round(task_text, steps_a, steps_b)`, run only in
`compare()`, which takes no value. It is one `gl.vm.run_nondet_unsafe(leader_fn,
validator_fn)` block with four sequential askings in its leader closure. All
four `gl.nondet.exec_prompt` calls in the file go through `_ask`, called only
inside that closure. Nothing is nested.

Each asking is built by `_asking(task_text, steps_a, steps_b, framing,
order)`:

| `ASKED_AS` | framing | order | shown as WORKING A | shown as WORKING B |
|---|---|---|---|---|
| `same/a_then_b` | `FRAMING_SAME` | `ORDER_AB` | checker A's working | checker B's working |
| `same/b_then_a` | `FRAMING_SAME` | `ORDER_BA` | checker B's working | checker A's working |
| `first/a_then_b` | `FRAMING_FIRST` | `ORDER_AB` | checker A's working | checker B's working |
| `first/b_then_a` | `FRAMING_FIRST` | `ORDER_BA` | checker B's working | checker A's working |

Each working keeps its own step numbers under either label. The questions are
`QUESTION_SAME` ("Do WORKING A and WORKING B reach the same final result for
the TASK? Answer yes, no or unclear.") and `QUESTION_FIRST` ("Reading both
workings step by step in order, what is the number of the first step at which
WORKING B states a different figure, rule or conclusion from WORKING A's step
with the same number? Answer that number, or NONE if no step differs."), each
followed by its key (`KEY_SAME`, `KEY_FIRST`), which says what every answer
means, and by the JSON shape to return. The two framings differ only in the
question; the blocks are identical.

`_read_word(raw)` reads one SAME answer as `yes`, `no` or `unclear` (`true`,
`false` and a JSON boolean as yes or no, `unsure` as unclear), or `""`.
`_read_first(raw, most)` reads one FIRST answer as a step from 1 to `most`,
the longer working's step count, written as an int or one or two ASCII digits
with no leading zero; `PICK_NONE` for the word NONE in any case; `PICK_UNREAD`
for anything else. `_combine(same_ab, same_ba, first_ab, first_ba)` returns
`agree` when both SAME readings are yes and both FIRST readings are NONE,
`diverged` at k when both SAME readings are no and both FIRST readings name the
same step k, and `unclear` otherwise. The stored value is `{"finding": ...,
"step": ...}`, the step as a string, `"0"` unless diverged.

**The comparison.** `validator_fn` is one line, `return _agrees(leaders_res,
leader_fn)`. `_agrees` returns `False` for a leader that raised and for a
result that is not a dictionary, reruns the whole leader closure inside
`try/except` (its own failure is a disagreement), and compares the finding and
the step by exact string equality. After the round, `_clean_finding` puts the
agreed value back into the contract's own shape: a diverged step must be one
of the workings' steps, and anything else is `unclear`.

**The readings in the result.** The leader also returns `r`, its four readings
joined by commas. Only the finding and the step are compared and stored.
`_clean_readings` turns `r` into an object keyed by asking for the call's
result, and returns `{}` unless there are exactly four readings, each written
the way the contract writes it, that combine to the agreed value.

**The prompt boundary.** `_block(label, text)` fences the text and writes it
between `<<<LABEL tag>>>` and `<<<END LABEL tag>>>`, `tag` being the first 16
hex characters of the sha256 of the fenced body; it is the only place a
delimiter is written. The labels are the contract constants `TASK`,
`WORKING_A` and `WORKING_B`. `_working_body` numbers the steps (`Step 1: ...`)
and is only ever the text of a block. Before the blocks each prompt states the
task (`PREAMBLE`), that all three blocks are untrusted and what a block says
about itself counts for nothing (`UNTRUSTED`), that only whether the workings
match is judged, not whether either is right (`SCOPE`), and that the labels
carry no meaning (`ORDER_NOTE`). No amount, address, digest or salt is a
parameter of the round.

### Commit and reveal

`commit(task_id, digest)` takes `sha256(working + "|" + salt)` as 64 hex
characters (any case, stored lower case), once per checker, before the commit
deadline, and refuses the other checker's digest. `reveal(task_id, working,
salt)` takes the working exactly as it was sealed, a JSON array of steps, and
the salt (16 to 64 ASCII letters and digits), only from a checker that
committed, only once both have committed or the commit window has closed, and
only before the reveal deadline. It caps the working at 4,000 characters,
checks the digest, and only then reads the shape: a flat array of 2 to 12
steps, each 3 to 300 printable ASCII characters on one line, at most 1,800
together, read with hooks that refuse every fraction. The steps are stored
trimmed, one row each. When both are revealed the task is `revealed`.

### State

One storage dataclass of scalars only (a collection inside a storage dataclass
kills the VM):

| `Task` field | type | what it is |
|---|---|---|
| `requester`, `beneficiary`, `checker_a`, `checker_b` | `Address` | the four parties, four different addresses, none of them this contract |
| `text` | `str` | the task as judged, 40 to 1,500 printable ASCII characters |
| `payout`, `fee` | `u256` | the payout, and each checker's fee, in atto |
| `status` | `str` | `open`, `revealed`, `unclear`, `held`, `paid`, `released`, `refunded`, `defaulted` or `expired` |
| `opened_at`, `commit_deadline`, `reveal_deadline` | `u64` | when it was opened, and its two windows, on the message clock |
| `digest_a`, `digest_b` | `str` | each checker's commitment, `""` until made |
| `steps_a`, `steps_b` | `u32` | each working's step count, 0 until revealed |
| `finding`, `step` | `str`, `u32` | the stored consensus value |
| `readings` | `u32` | times the task was read (at most two) |
| `unclear_at`, `decide_by`, `closed_at` | `u64` | when it read unclear, the end of the requester's decision window, when it was settled |
| `paid_beneficiary`, `paid_requester`, `paid_a`, `paid_b` | `u256` | what the task has sent to each party; what it still holds is its value less their sum |

| map | key | value |
|---|---|---|
| `task_rows` | `T1`, `T2`, ... (contract-assigned) | the `Task` |
| `step_rows` | `T1:a:3` | the third step of checker A's working on T1 |
| `index_rows` | `<address>:4` | the fourth task that address is a party to |
| `index_count_rows` | `<address>` | how many tasks that address is a party to |

Scalar counters (`task_count`, `reading_count`, `agreed_count`,
`diverged_count`, `unclear_count`, `held_count`, `released_count`,
`refunded_count`, `defaulted_count`, `expired_count`, `refusal_count`),
`held_value`, what the contract owes, which equals its balance after every
call, and `paid_total`.

### Key methods

| method | kind | what it does |
|---|---|---|
| `open_task(beneficiary, task_text, checker_a, checker_b, payout_atto, fee_atto, commit_seconds, reveal_seconds)` | payable write | the sender is the requester; checks the parties, the text, the amounts, the windows, the exact value and the clock, and on any refusal returns `ok: false` with everything sent; asks no model, never raises; stores the task and indexes all four parties |
| `commit(task_id, digest)` | write | a checker seals its working, once, in the commit window |
| `reveal(task_id, working, salt)` | write | a checker opens its working, once, after both commits or the commit window |
| `compare(task_id)` | write, takes no value | anyone, on a `revealed` task or, 300 seconds after it, an `unclear` one: the round, then at most three transfers in the same call |
| `decide(task_id, release)` | write | the requester, while `held`: the payout to the beneficiary (`true`) or back (`false`) |
| `default_refund(task_id)` | write | anyone, `DECIDE_SECONDS` after the hold: the payout back to the requester |
| `expire(task_id)` | write | anyone: an `open` task once nothing more can arrive, or a `revealed` or `unclear` task `COMPARE_SECONDS` after the reveal deadline; the payout to the requester, each fee to its checker if it revealed and to the requester if not |
| `task(task_id)` | view | the task, both workings once revealed, the finding and the step, what it paid and holds, the message clock, and whether it may be expired now |
| `tasks_of(who, offset, limit)` | view | a page of at most 20 of one address's tasks, with its role in each |
| `tasks(offset, limit)` | view | a page of at most 20 tasks |
| `stats()` | view | the counts, `paid_total` and `balance_owed` |
| `rules()` | view | both questions and keys word for word, the askings, how answers are read and combined, what is compared, the money, the windows, who may do what, the sizes and every limit |

Every view takes a short id, small integers or one address: a Studio read
fails once the encoded call passes 256 bytes.

### Bounds

| constant | value | what it bounds |
|---|---|---|
| `MAX_STEPS` | 12 | steps of one working; the loops of `_read_working`, `_working_body`, `_steps` and `reveal` |
| `PAGE_CAP` | 20 | rows per page of `tasks()` and `tasks_of()` |
| `MAX_WORKING_JSON`, `MAX_TASK`, `MAX_ARG` | 4,000, 1,500, 64 | characters of a working as sent, of a task, of an id, number or address as sent, each capped before it is stripped or walked |
| `REREAD` | 1 | extra readings of an unclear task |

`compare`, `decide`, `default_refund` and `expire` read one task row (and
`compare` at most 24 step rows) and make at most three transfers. The only
other loops read the characters of one capped argument or the parts of the
message clock. A static test fails on any other loop, and on any loop a write
can reach that may run more than twelve times.

### Windows

| constant | value | what it is |
|---|---|---|
| `MIN_WINDOW`, `MAX_WINDOW` | 600 s, 7 days | the range of each of the commit and reveal windows the requester sets |
| `REREAD_AFTER` | 300 s | the cooldown before an unclear task is read again |
| `DECIDE_SECONDS` | 3 days | the requester's decision window on a held payout |
| `COMPARE_SECONDS` | 3 days | after the reveal deadline, how long two revealed workings wait for a reading that settles them before anyone may expire the task |

### Reuse

`task(id)` is the reusable answer: `finding` `agree` means the network found
two independently sealed workings of the task reach the same result step by
step; `diverged` with `step` names where they part, next to both workings. A
payroll, a refund desk or a grant contract reads it and pays accordingly. The
round is reusable on its own: `_compare_round` compares any two numbered
workings of one task, in both orders and with two framings that check each
other, with every disagreement stored as `unclear` rather than smoothed away.

### Limits

- Two colluding checkers can agree on a wrong result; the contract buys
  independence, not truth.
- The network judges whether the two workings match each other, not whether
  either is right, and never sees the amount locked.
- The requester names both checkers; a checker on its side can always send
  the payout back, by diverging or by not revealing.
- The same result reached by other steps reads `unclear`, not `agree`.
- An unclear task is read once more, then held for the requester.
- A round no majority carries stores nothing; `COMPARE_SECONDS` after the
  reveal deadline the task may be expired.
- English in printable ASCII on one line; a working of 2 to 12 steps.
- A transaction with no readable clock is refused, never guessed.
