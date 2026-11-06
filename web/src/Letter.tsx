import { h } from "preact";

export interface Charge { description: string; amount_gbp: number }
const gbp = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2 });

/** The landlord's letter, rendered from the fixture manifest's charge list and the letter's printed content. */
export function Letter({ charges, active }: { charges: Charge[]; active?: Set<number> }) {
  const total = charges.reduce((a, c) => a + c.amount_gbp, 0);
  return (
    <article class="letter" aria-label="The landlord's deduction letter">
      <div class="letter-bar" />
      <header class="lh"><b>Elmfield Lettings</b><span>Lettings &amp; Property Management | Bristol</span></header>
      <div class="l-addr"><address>Alex Morgan<br />Flat 3B, 14 Elm Road<br />Bristol</address><time>4 November 2026</time></div>
      <h3>Re: Return of tenancy deposit</h3>
      <dl class="l-facts"><div><dt>Property</dt><dd>Flat 3B, 14 Elm Road, Bristol</dd></div><div><dt>Tenancy</dt><dd>12 March 2024 to 30 October 2026</dd></div><div><dt>Deposit held</dt><dd>£1,200.00</dd></div></dl>
      <p>Dear Alex Morgan, following the end of your tenancy and our check-out inspection, we propose to make the deductions below from your deposit.</p>
      <table class="l-table">
        <thead><tr><th>Proposed deductions</th><th>Amount</th></tr></thead>
        <tbody>
          {charges.map((c, i) => <tr key={i} class={active?.has(i) ? "on" : ""}><td>{c.description}</td><td>{gbp(c.amount_gbp)}</td></tr>)}
        </tbody>
        <tfoot>
          <tr><td>Total deductions</td><td>{gbp(total)}</td></tr>
          <tr class="bal"><td>Balance to be returned</td><td>{gbp(1200 - total)}</td></tr>
        </tfoot>
      </table>
      <p class="l-small">If you disagree with any of these deductions, please respond within 14 days of the date of this letter, setting out which charges you dispute and why. Any evidence, such as dated photographs from the start or end of the tenancy, is welcome.</p>
      <p class="l-sign">Yours sincerely,<br /><b>Elmfield Lettings, Deposits Team</b></p>
      <p class="l-fict">Sample letter for a staged demo. Fictional names and address.</p>
    </article>
  );
}
