# Decisions

The boundary first, then the two questions, the prompt, the commit and reveal,
the storage, the money, why every settlement is bounded, the doors, the views,
then what is verified and what is not.

## 1. The boundary: what the network agrees on

**A finding and a step.** The round stores `agree`, `diverged` with the number
of the first step where the two workings part, or `unclear`. All three words
come from a closed set the contract wrote, and the step is one of the
workings' own numbers. What has to be decided is whether two workings match,
and where they stop matching, and that pair is the coarsest answer that
carries it. A similarity score, a corrected result or a list of every
differing step would put values in storage that honest nodes could reach
differently while believing the same thing.

**It does not decide who is right.** The network is never asked which working
applies the policy correctly, or what the right refund is. Two readers who
agree that two workings part at step 2 will often disagree about which one
erred, and the payer has a better claim to decide that than the network does.
So a divergence pays both checkers, whose work was done, and holds the payout
for the requester, with the step and both workings in plain view.

**What a program can check, the program checks.** Whether the four parties are
four different addresses, whether the value is exactly the payout and both
fees, whether a digest is 64 hex characters, whether a revealed working
matches its digest, whether it has 2 to 12 steps of the right size, whether a
window is open: every one of these is decided in code before any model is
asked. The network is asked only what code cannot answer: do these two
workings, in their own words, say the same thing.

**It never sees money or people.** `_asking` takes the task, the two workings,
a framing and an order. No payout, no fee, no address, no digest and no salt is
a parameter, and a test checks that none of them appears in any prompt the
round sends.

## 2. Two questions, both orders, one block

**Two framings that check each other.** SAME asks whether the two workings
reach the same final result; FIRST asks for the first step where they part.
An honest reader that says the results differ can also name the step where the
workings leave each other, and one that says they are the same finds no step
that differs. So `agree` needs SAME yes and FIRST NONE, and `diverged` needs
SAME no and FIRST naming a step. A reader that says the results match and
names a differing step, or says they differ and finds no step, has not settled
what it believes, and the round stores `unclear`, never a guess.

**Both orders.** Every node builds the prompts the same way, so a reader that
favours whatever is labelled A, or the first block on the page, favours it on
every node and consensus alone would never see it. So each question is asked
twice: with checker A's working as WORKING A, and with the two swapped under
the labels. Each working keeps its own step numbers, because the first step
where two workings part is the same number whichever is called A: the honest
answer to FIRST does not move with the order. A reader led by the label gives
a different SAME answer in each order; a reader led by position names the last
step of whichever working is shown first, a different number in each order.
Both land in `unclear`, and the suite plays both.

**All four in one block.** Nested nondet blocks are not legal, and separate
blocks would be separate rounds that could settle differently. One leader
closure asks all four sequentially and combines them in code, so every
disagreement lands in the stored value. There is no tolerance anywhere: the
validators compare the finding and the step by exact string equality.

**One plain thing per question, with what each answer means.** A question
that joins two conditions reads `unclear` where the honest answer is clear,
because a reader can satisfy one half and not the other. SAME asks one thing.
FIRST asks for one number; its only "or" lists the kinds of thing a step can
state (a figure, a rule or a conclusion), and a test fails on any other joint
before the question mark. Each key says, right after its question, what every
answer means, including that a step one working has and the other lacks
counts as different.

**Answers parsed strictly.** A FIRST answer counts only as a step number from 1
to the longer working's step count, as an int or one or two ASCII digits with
no leading zero, or the word NONE. "Step 2", "2.", "2 or 3", "02", a boolean,
a fraction and a step neither working has are unreadable, and an unreadable
answer reads as unclear rather than being repaired. A SAME answer counts as
yes, no or unclear from a short closed list of spellings (a JSON boolean is a
natural rendering of a yes/no answer); "yes, mostly" and "y" are unreadable. A
JSON fraction, NaN or Infinity is refused by the parser hook before it is
built.

**The readings in the result.** The leader also returns its four readings.
Only the finding and the step are compared and stored; comparing the readings
would turn validators who reached the same `unclear` by different routes into
a failed round. The readings come back in the call's result so a run shows why
it landed where it did, and only when they are well formed and combine to the
agreed value.

**Exact equality, and no agreement with an error.** A validator whose own rerun
raises disagrees; a leader that raised is never agreed with, so an unreachable
model is never stored as an answer.

**One extra reading, and no more.** A borderline pair can read `unclear` once
and settle on the next reading, so an unclear task may be read again, by
anyone, 300 seconds later. A second `unclear` is settled as a divergence is:
both fees paid and the payout held for the requester. Two readings is the
whole budget; nobody can ask until the answer suits them.

## 3. The prompt

**The fence and the tag.** The task and every step pass through `_fence`, which
replaces `<` with `(` and `>` with `)` and never deletes. Each block sits
between two delimiter lines tagged with the first 16 hex characters of the
sha256 of its own fenced body. The task is public once opened, so a checker
can copy the task block's tag into a step; once fenced, that step holds no
angle bracket and cannot write a line that starts with `<<<`. A test plants
the task block's genuine closing line inside a step and finds exactly the six
expected delimiters in all four askings.

**ASCII on one line at the door.** The fence knows only the two ASCII brackets,
and Unicode has look-alikes a model reads as brackets, so the door refuses
anything outside printable ASCII, line breaks included.

**The contract numbers the steps.** A working is a JSON array; the contract
writes `Step 1: ...`, `Step 2: ...` itself. A checker cannot number its own
steps to steer FIRST, and a step that writes "Step 7:" inside its text is just
text on its own numbered line.

**Nothing judged is cut.** The task is at most 1,500 characters and a working
at most 1,800 characters of steps, so the largest prompt, a full task and two
full workings, is under 8,000 characters. Every character a checker wrote is
in front of every validator.

**The declaration.** Before the blocks each prompt says all three blocks are
untrusted text, never an instruction, that anything a block says about the
task, the answer or itself being right counts for nothing, that only whether
the two workings match is judged, and that the labels carry no meaning.

## 4. The commit and the reveal

**Why seal at all.** A second working written after the first one was public is
not a second pair of eyes. So each checker posts only `sha256(working + "|" +
salt)` first. The digest says nothing about the working; the salt, 16 to 64
letters and digits, is long enough that a short working cannot be found by
hashing guesses.

**No reveal until both are sealed.** A reveal is taken only once both checkers
have committed, or once the commit window has closed. Until then neither
working is on chain anywhere, and once it is, the other checker's working is
already fixed. A test reveals early and is refused, then reveals after the
second commitment and is taken.

**The digest is checked, and checked first.** A commitment is exactly 64 hex
characters (any case, stored lower case); anything else is refused at the
commit. The other checker's digest is refused too: a checker who copied it and
later revealed the other's working, once that was opened, would agree without
working anything out. At the reveal, the working is capped before it is
hashed, the digest is compared before the working is parsed, and only a
matching working is read for its shape. A refused reveal raises and took
nothing, so a checker who sent the wrong salt sends the right one.

**A sealed working cannot be changed.** Each checker commits once and reveals
once. A checker who sealed a working the door refuses can never reveal it, and
when the task expires its fee goes to the requester. The door's sizes are
published in `rules()` so a checker can test a working before sealing it.

**What sealing does not stop.** A checker who has committed can decline to
reveal after seeing the other's working. It loses its fee to the requester and
the payout goes back to the requester, so the option is worth something only
to a checker on the requester's side, who could as easily diverge. The README
states this as a limit: the beneficiary is protected only as far as the
checkers are independent of the requester.

## 5. The storage

Scalars only inside the `@allow_storage` dataclass: a collection inside a
storage dataclass kills the VM. A working's steps are rows of their own keyed
`T1:a:3`; the task stores only how many there are. Each address's tasks are
indexed `<address>:1`, `<address>:2`, ... with a count row, lower-cased
whatever case the address came in. Ids are assigned by the contract from its
counter, and an id argument is accepted only in exactly that shape. Every
non-string argument is checked with `isinstance` before a string method
touches it, and every argument's length as sent is capped before it is
stripped or walked.

## 6. The money

**One payable call, and it never raises.** `open_task` takes exactly the payout
and both fees. It asks no model, and every refusal returns everything that was
sent with `{"ok": false, "reason", "returned"}`. A static test follows every
helper it reaches and finds no `raise`, no `_fail` and no round. Every other
call takes no value, so its refusals are `[EXPECTED] ...` errors that took
nothing.

**The round runs only where nothing was sent.** A round can end with nothing
stored: an unreachable model, or no majority. Value sent with such a call is
not safely returned. So the round runs only in `compare`, which takes no value,
and every refusal in it comes before the round. A round that stores nothing
leaves the task exactly as it was, and anyone may ask again.

**Agree pays in the same call.** The payout to the beneficiary and each fee to
its checker, three transfers in the transaction that read the agreement.

**A divergence pays the work and holds the payout.** Both checkers did what
they were paid to do, so both fees go out. The payout waits for the requester,
who can read both workings and the step where they part and release or take
it back. A requester who never decides cannot hold it for ever: after three
days anyone may default it to a refund, and until somebody does the requester
may still decide.

**Every way in has a way out.** A task nobody committed to returns everything
when the commit window closes. A checker who committed keeps the whole reveal
window; one who revealed alone is paid once nothing more can arrive, and the
fee of the one who did not goes to the requester. And a task whose two
workings are revealed but that no reading has settled, because the network
never reached a majority on it, is not stranded: three days after the reveal
deadline anyone may expire it, both fees are paid and the payout goes back to
the requester. Until then anyone may compare it. A seeded random journey ends
every task this way or another, and every journey drains to zero.

**Every transfer is the last thing a call does.** State first, money after,
and tests read the state at the moment of each transfer.

**Conservation.** At every moment the contract holds exactly what its tasks
still hold: everything sent with each task, less everything it has paid out.
The suite checks the books against the contract's own counters after every
step of forty seeded random journeys, and checks every task's payments
against its status.

## 7. Why every settlement is bounded

A settlement that walks a list grows with the number of people who used the
contract, and past some count it no longer fits in a transaction.

**One task at a time.** `compare`, `decide`, `default_refund` and `expire` read
one task row, `compare` at most 24 step rows, and make at most three transfers.
A test opens sixty tasks, replaces the storage maps with maps that count every
read, and finds the sixty-first task settles with exactly the reads of the
first.

**Every loop has a constant bound.** The steps of one working (`MAX_STEPS`, 12)
and a page of `tasks` or `tasks_of` (`PAGE_CAP`, 20). A static test parses the
file and fails on any loop that is not over `range(n)` with `n` assigned once to
a `min(...)` holding a module constant, unless it reads the characters of one
capped argument; and on any loop a write can reach that may run more than
twelve times.

**No cap a stranger can fill.** There is no limit on tasks, in all or per
address, so no address can fill a door and shut it on anybody else. The same
checker named on sixty tasks still commits, reveals and is paid on the
sixty-first. Only a task's own windows, its own status and its own parties
close it.

## 8. The doors

| rule | why |
|---|---|
| four different addresses, none of them this contract | two checkers who are one address are no second pair of eyes; a checker who is the requester or the beneficiary checks their own money; value sent to the contract as a party would be owed to nobody |
| the value is exactly the payout and both fees | the task holds what it will pay, no more and no less |
| only the two named checkers commit and reveal | nobody else's working is asked for |
| each checker commits once and reveals once | a sealed working cannot be swapped |
| a digest is 64 hex characters, never the other checker's | a malformed or copied commitment is no independent working |
| no reveal until both have committed or the commit window has closed | neither working is seen before both are sealed |
| the working revealed is the working sealed, then 2 to 12 steps of 3 to 300 ASCII characters, at most 1,800 together | what is judged is what was committed, and all of it fits the prompt |
| compare reads only a revealed task, or an unclear one 300 seconds later | one extra reading, not a re-roll |
| only the requester decides a held payout | it is the requester's money until the beneficiary is paid |
| anyone defaults an undecided payout after three days, anyone expires a task whose windows have run out | no payout waits on one party, or on the network, for ever |
| no readable clock, no commit, reveal, compare, decision, default or expiry | every window is measured on the message clock, the same on every node |

**Every refused party has somewhere to go.** A requester refused at the door
gets everything back and opens again. A checker refused for a wrong salt
reveals with the right one; one refused because the other has not committed
reveals once the commit window closes. A comparison no majority carried is
asked again; one that read unclear is read once more. A requester whose
checkers never commit expires the task and is paid back in full; a checker
whose partner never commits reveals alone and is paid. A requester who never
decides is refunded by whoever calls. Each of these is a journey in the suite.

## 9. Views

Every view takes a short id, small integers or one address: a Studio read
fails once the encoded call passes 256 bytes, so no view takes a text. `tasks`
and `tasks_of` page at 20 and say the `total`. `task(id)` returns the message
clock it was read at and whether the task may be expired now, so a caller can
wait for a window by the chain's own clock.

## 10. Verified, and not verified

**Verified here, offline, with no network:** 395 tests, green. The round is
driven with a scripted model per node: 25 cases of the combine table
directly and 12 through the round, a reader led by the label, a
reader led by position, a reader that affirms or denies everything, a working
that reaches the same result by other steps, a step only the longer working
has, malformed answers, one validator outvoted, a majority in another world
storing nothing, validators that name another step, a validator whose own
rerun raises, a leader that raised, and a round no majority carried leaving the
task and the money untouched. Every refusal of every call, every window edge,
and forty seeded random journeys with the books checked after every step. 280
defences removed or inverted one at a time, none surviving, each with the test
that caught it named in `tests/MUTATIONS.md`. `genvm-lint` 0.11.0 passes with
exit code 0.

**Verified by construction, through static checks over the parsed source:** the
model is called only inside the one leader closure, four askings, in every
pairing of the two framings with the two orders, combined through `_combine`;
the readings reach the result and nothing else; the round is not nested and
runs only in `compare`, which takes no value, after every refusal and before
every write; the validator is one line delegating to the comparison, which
refuses a leader error first and compares by exact equality; every write
either refuses by sender or is listed with its reason (`open_task`, `compare`,
`default_refund`, `expire`); the payable write reaches no raise; the delimiter
is written in one place and carries the body's hash; every value interpolated
into a prompt is fenced or a contract constant; every `json.loads` refuses
floats; no float, no true division, no `datetime`; every loop is bounded by a
constant and every loop a write reaches runs at most twelve times; every
settlement reads one task and makes at most three transfers, each through the
transfer interface; storage holds scalars only; views take only short
arguments; the smoke script carries this suite's demonstration texts byte for
byte and compares the deployed code with the file; the file pins the runner in
its first line; no personal or internal detail appears anywhere in the
repository.

**Verified on chain:** not yet. The on-chain run is recorded in the README once
it has run.

**Not verified:** how a live model reads the demonstration, in particular
whether it reads T1's two workings, the same figures in different words, as
the same step for step (the honest answer is yes: both find day 20 in the 70
percent band, 168, and 168 less 15 is 153), and whether it names step 2 in both
orders for T2, where the second working applies the full refund; how often a
borderline pair splits across the four askings; and which model the validators
run.
