# Guide: Move-out Proof

## Who it is for

Renters. Moving out is when deposits are lost: a deduction letter arrives listing cleaning, carpet and wall charges, and the photos that would answer each charge are somewhere among years of backed-up phone photos. Deposit schemes decide on the evidence each side sends; tenant advice services tell renters to compare their move-in and move-out photos of the same spot, charge by charge, and the schemes prefer digital photos because their dates can be checked.

## What to say

- "My landlord is deducting £420 from my deposit. I moved in on 12 March 2024 and moved out on 30 October 2026. The letter is in Documents, Tenancy."
- "Help me answer my deposit deduction letter."
- "I hand back the keys next week. Which parts of the flat have no move-in photo?"
- "Find my move-in and move-out photos for the oven and the carpet."

## What happens

1. You confirm your move-in and move-out dates. The Skill tells you the windows it will search.
2. It finds the photos taken in each window and reads their capture dates from the photo metadata.
3. The vision model names the spot in each photo (from a fixed list such as kitchen-oven or living-room-carpet) and notes visible marks. Photos it cannot read are listed as Unclear instead of guessed.
4. It reads the charges from your letter and lines up, under each charge, the move-in and move-out photo of that spot, with their dates.
5. It shows you everything it plans to create and waits for your approval.
6. After you approve: an album of the pairs, a `Deposit_Evidence` folder next to your letter with copies of the photos, and a report.

## What it will not do

- It does not say whether a charge is fair. You decide what to dispute.
- It does not invent a photo, a date or a charge. A missing photo is shown as a gap.
- It does not delete, move, send or share anything. Originals stay where they are; the folder holds copies.
- It does not write anything before you approve the exact list.

## Gap mode, before you move out

Ask which spots have no move-in photo. You get a table of the spots it found, with what is missing. Photograph those spots now and look for older photos of them; a gap found before you hand back the keys can still be filled.
