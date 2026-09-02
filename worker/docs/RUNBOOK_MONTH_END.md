# Month-End Close Runbook (CFO v1, issue #19738 CP7)

Manual steps for Ariel/whoever runs month-end close on the `mocerqjnksmhcjzxrewo`
Supabase project. Everything here is idempotent — safe to re-run a step that failed
partway through.

## 1. Sync Plaid (bank feed)
Trigger `everest-bank-engine`'s transaction sync for each connected `bank_connections`
row (issue #19737). Confirm new rows landed:
```sql
select bc.entity_code, count(*) as new_rows, max(bt.posted_on) as latest
from finance.bank_transactions bt
join finance.bank_accounts ba on ba.id = bt.bank_account_id
join finance.bank_connections bc on bc.id = ba.connection_id
where bc.status != 'fixture'
group by bc.entity_code;
```
If this still returns 0 rows for an entity, #19737 hasn't been connected for that
entity yet — fall back to the fixture path documented in `PORTING_NOTES.md`, or skip
reconciliation for that entity this month and note it as a gap, not a silent pass.

## 2. Sync Stripe payouts + balance transactions
```
python3 cli-anything-biddeed/scripts/stripe_payouts_sync.py --since <last_close_epoch>
```
(also runs automatically via `.github/workflows/stripe-payouts-sync.yml`, daily
13:00 UTC — this step is a manual re-check, not the only trigger). Confirm parity:
```sql
select count(*) from stripe.payouts where created >= <since>;
select count(*) from stripe.balance_transactions where created >= <since>;
```
against the equivalent paginated Stripe API count (see the migration header comment
in `20260902i_stripe_payouts_balance_tx.sql` for the exact parity-check pattern used
at CP3 close).

## 3. Run `finance.recon_run()`
```sql
select * from finance.recon_run(null, '<first_day_of_period>');
```
Pass an explicit `p_entity_code` to re-run a single entity. Review the returned
`(entity_code, bank_rows, matched, exceptions_opened)` rows — a large jump in
`exceptions_opened` vs the prior month is the first signal something's wrong
upstream (a vendor renamed themselves, a new payout schedule, etc.), not something to
wave through.

## 4. Review exceptions
```sql
select * from finance.v_recon_exceptions where status = 'open' order by entity_code, txn_date;
```
or the dashboard's Bank Reconciliation → Exceptions table
(`everest-cfo-agent.brevardbidderai.workers.dev`, gated by `CFO_AGENT_SHARED_SECRET`).
For each open exception:
- `unmatched_credit` / `unmatched_debit` — a real bank row with no ledger/Stripe
  counterpart. Either it's a ledger gap (go add the `expense_ledger`/`revenue_ledger`
  row, then re-run step 3) or it's genuinely unexplained (escalate to Ariel).
- `no_bank_evidence` — a posted ledger entry with no matching bank row yet. Usually
  just timing (bank feed lags the ledger entry by a few days) — re-check after the
  next Plaid sync before treating it as a real discrepancy.

Mark resolved exceptions:
```sql
update finance.recon_exceptions set status = 'resolved', resolved_at = now(),
  resolution = '<what happened>' where id = '<exception_id>';
```

## 5. Post drafts (litigation-gated entities)
Any entity in `finance._litigation_gated()` (currently `everest_capital`) accumulates
journal entries with `posted_at IS NULL` instead of auto-posting. Review each draft
personally before posting — this is the propose-only Tier-1 gate, not a bug:
```sql
select je.id, je.entity_code, je.entry_date, je.memo,
  p.debit_cents, p.credit_cents, a.name as account
from finance.journal_entries je
join finance.postings p on p.entry_id = je.id
join finance.accounts a on a.id = p.account_id
where je.posted_at is null
order by je.entry_date;
```
Post one by one once reviewed:
```sql
update finance.journal_entries set posted_at = now() where id = '<entry_id>';
```

## 6. Verify balance
```sql
select * from finance.assert_balanced();
```
Must return 0 rows. If it doesn't, STOP — do not close the period. A non-empty
result means some journal entry has debits ≠ credits, which should be structurally
impossible given `trg_postings_balance` (#19716) — treat it as a data integrity
incident, not something to paper over.

## 7. Close
```sql
select * from finance.v_recon_summary order by entity_code, period desc limit 20;
```
Confirm `matched_pct` and `variance_cents` look right for the period, then record the
close in `finance.cfo_checkpoints` (checkpoint text should name the period and cite
this runbook, so future sessions can find how the numbers were produced).
